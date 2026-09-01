// 佳禾换物小站 - 云函数 campusApi
// 聚合所有后端操作（物品/申请/举报/用户），并在云端统一做内容安全审核。
// 部署：在微信开发者工具中右键本目录 -> 上传并部署：云端安装依赖。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const COL = {
  items: 'items',
  applications: 'applications',
  reports: 'reports',
  users: 'users'
}

// 管理员密钥：用于「我的 → 管理员验证」输入后成为管理员（处理举报）。
// ⚠️ 上线前务必改为你自己的强随机字符串，并妥善保密。
const ADMIN_SECRET = 'EFULQegQtvthmjFR6TXY'

// 首次请求时确保集合存在（免去手动建库）。集合已存在时 createCollection 抛错，忽略即可。
let collectionsReady = false
async function ensureCollections() {
  if (collectionsReady) return
  for (const name of [COL.items, COL.applications, COL.reports, COL.users]) {
    try {
      await db.createCollection(name)
    } catch (e) {
      // 已存在或权限受限，忽略
    }
  }
  collectionsReady = true
}

// ===================== 工具函数 =====================

// 内容安全 - 文本检测（微信 msgSecCheck）
// 返回 { passed, message }
async function checkText(text, openid) {
  if (!text || typeof text !== 'string') return { passed: true }
  try {
    const res = await cloud.openapi.security.msgSecCheck({
      version: 2,
      openid: openid,
      scene: 2,
      content: text
    })
    // errCode 87014 表示命中违规
    if (res.errCode === 87014) {
      return { passed: false, message: '内容包含违规信息，请修改后重试' }
    }
    return { passed: true }
  } catch (e) {
    // 未开通内容安全服务时，兜底放行（仅开发期）。生产环境请务必在云开发控制台开通内容安全。
    console.warn('msgSecCheck 调用失败（可能未开通内容安全）:', e)
    return { passed: true }
  }
}

// 内容安全 - 图片检测（微信 imgSecCheck）
async function checkImages(images) {
  if (!images || !images.length) return { passed: true }
  for (const fileID of images) {
    try {
      const dl = await cloud.downloadFile({ fileID })
      const buffer = dl.fileContent
      const contentType = fileID.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
      const res = await cloud.openapi.security.imgSecCheck({
        media: { contentType, value: buffer }
      })
      if (res.errCode === 87014) {
        // 检测不通过，删除已上传的违规图片
        try { await cloud.deleteFile({ fileList: [fileID] }) } catch (e) {}
        return { passed: false, message: '图片包含违规内容，请更换后重试' }
      }
    } catch (e) {
      console.warn('imgSecCheck 调用失败（可能未开通内容安全）:', e)
    }
  }
  return { passed: true }
}

// 给发布者增加积分
async function addPoints(openid, points, donateCount) {
  const users = await db.collection(COL.users).where({ _openid: openid }).get()
  if (users.data.length) {
    const u = users.data[0]
    await db.collection(COL.users).doc(u._id).update({
      data: { points: _.inc(points), donateCount: _.inc(donateCount) }
    })
  }
}

// 判断当前用户是否管理员（users 集合 isAdmin 标记）
async function isAdminUser(openid) {
  if (!openid) return false
  const res = await db.collection(COL.users).where({ _openid: openid, isAdmin: true }).get()
  return res.data.length > 0
}

// ===================== 各 Action 实现 =====================

// 登录 / 同步用户资料
async function login(event, openid) {
  const { nickName, avatarUrl } = event
  const users = await db.collection(COL.users).where({ _openid: openid }).get()
  if (users.data.length === 0) {
    await db.collection(COL.users).add({
      data: { _openid: openid, nickName: nickName || '公益参与者', avatarUrl: avatarUrl || '', points: 0, donateCount: 0, createTime: db.serverDate() }
    })
    return { success: true, openid, nickName: nickName || '公益参与者', avatarUrl: avatarUrl || '', points: 0, donateCount: 0 }
  } else {
    const u = users.data[0]
    await db.collection(COL.users).doc(u._id).update({
      data: { nickName: nickName || '公益参与者', avatarUrl: avatarUrl || '' }
    })
    return { success: true, openid, nickName: u.nickName || '公益参与者', avatarUrl: u.avatarUrl || '', points: u.points || 0, donateCount: u.donateCount || 0 }
  }
}

// 发布物品（含内容安全审核）
async function publish(event, openid) {
  const {
    title, description, category, images, allowBarter, location, locationName,
    publisherNickName, publisherAvatarUrl
  } = event

  if (!title || !title.trim()) return { success: false, message: '标题不能为空' }
  if (!description || !description.trim()) return { success: false, message: '描述不能为空' }

  const textCheck = await checkText(title + ' ' + description, openid)
  if (!textCheck.passed) return { success: false, code: 'CONTENT_RISK', message: textCheck.message }

  const imgCheck = await checkImages(images)
  if (!imgCheck.passed) return { success: false, code: 'IMAGE_RISK', message: imgCheck.message }

  const res = await db.collection(COL.items).add({
    data: {
      _openid: openid,
      title: title.trim(),
      description: description.trim(),
      category: category || 'other',
      images: images || [],
      allowBarter: !!allowBarter,
      location: location || null,
      locationName: locationName || '',
      status: 'available',
      publisherNickName: publisherNickName || '匿名',
      publisherAvatarUrl: publisherAvatarUrl || '',
      createTime: db.serverDate()
    }
  })
  return { success: true, id: res._id }
}

// 物品列表（分页 + 分类/关键词/仅看可换筛选），默认只返回 available
async function listItems(event) {
  const { category = 'all', page = 1, pageSize = 10, status = 'available', keyword = '', barterOnly = false } = event
  const conditions = []
  if (category !== 'all') conditions.push({ category })
  if (status) conditions.push({ status })
  if (barterOnly) conditions.push({ allowBarter: true })
  if (keyword && keyword.trim()) {
    conditions.push({ title: db.RegExp({ regexp: keyword.trim(), options: 'i' }) })
  }
  let q = db.collection(COL.items)
  if (conditions.length) q = q.where(_.and(conditions))
  const countRes = await q.count()
  const listRes = await q.orderBy('createTime', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get()
  return {
    success: true,
    list: listRes.data,
    total: countRes.total,
    hasMore: page * pageSize < countRes.total
  }
}

// 物品详情（含是否本人发布；本人可见该物品举报记录）
async function getItemDetail(event, openid) {
  const { id } = event
  if (!id) return { success: false, message: '物品ID缺失' }
  const res = await db.collection(COL.items).doc(id).get()
  if (!res.data) return { success: false, message: '物品不存在' }
  const isOwner = res.data._openid === openid
  let reports = []
  if (isOwner) {
    const r = await db.collection(COL.reports).where({ itemId: id }).orderBy('createTime', 'desc').get()
    reports = r.data
  }
  return { success: true, item: res.data, isOwner, reports }
}

// 删除物品（仅发布者）
async function deleteItem(event, openid) {
  const { id } = event
  const res = await db.collection(COL.items).doc(id).get()
  if (!res.data || res.data._openid !== openid) return { success: false, message: '无权删除该物品' }
  await db.collection(COL.items).doc(id).remove()
  // 级联清理关联申请与举报
  await db.collection(COL.applications).where({ itemId: id }).remove()
  await db.collection(COL.reports).where({ itemId: id }).remove()
  return { success: true }
}

// 编辑物品（仅发布者，已完成物品不可编辑）
async function updateItem(event, openid) {
  const { id, title, description, category, images, allowBarter, location, locationName } = event
  if (!id) return { success: false, message: '物品ID缺失' }
  const res = await db.collection(COL.items).doc(id).get()
  if (!res.data || res.data._openid !== openid) return { success: false, message: '无权编辑该物品' }
  if (res.data.status === 'completed') return { success: false, message: '已送出的物品不可编辑' }
  if (!title || !title.trim()) return { success: false, message: '标题不能为空' }
  if (!description || !description.trim()) return { success: false, message: '描述不能为空' }

  const textCheck = await checkText(title + ' ' + description, openid)
  if (!textCheck.passed) return { success: false, code: 'CONTENT_RISK', message: textCheck.message }
  const imgCheck = await checkImages(images)
  if (!imgCheck.passed) return { success: false, code: 'IMAGE_RISK', message: imgCheck.message }

  await db.collection(COL.items).doc(id).update({
    data: {
      title: title.trim(),
      description: description.trim(),
      category: category || 'other',
      images: images || [],
      allowBarter: !!allowBarter,
      location: location || null,
      locationName: locationName || ''
    }
  })
  return { success: true }
}

// 下架 / 重新上架（仅发布者；available <-> offline，completed 不可变更）
async function setStatus(event, openid) {
  const { id, status } = event
  if (!id) return { success: false, message: '物品ID缺失' }
  if (status !== 'available' && status !== 'offline') return { success: false, message: '无效的状态' }
  const res = await db.collection(COL.items).doc(id).get()
  if (!res.data || res.data._openid !== openid) return { success: false, message: '无权操作该物品' }
  if (res.data.status === 'completed') return { success: false, message: '已送出的物品不可变更状态' }
  await db.collection(COL.items).doc(id).update({ data: { status } })
  return { success: true }
}

// 我发布的物品
async function myPublish(openid, event) {
  const { page = 1, pageSize = 20, status = '' } = event
  let q = db.collection(COL.items).where({ _openid: openid })
  if (status) q = q.where({ status })
  const countRes = await q.count()
  const listRes = await q.orderBy('createTime', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get()
  return { success: true, list: listRes.data, total: countRes.total, hasMore: page * pageSize < countRes.total }
}

// 申请领取（含内容安全审核 + 防重复申请）
async function apply(event, openid) {
  const { itemId, message, itemTitle, applicantNickName, applicantAvatarUrl } = event
  if (!itemId) return { success: false, message: '物品ID缺失' }
  if (!message || !message.trim()) return { success: false, message: '请填写申请留言' }

  const textCheck = await checkText(message, openid)
  if (!textCheck.passed) return { success: false, code: 'CONTENT_RISK', message: textCheck.message }

  const exist = await db.collection(COL.applications).where({ itemId, _openid: openid }).get()
  if (exist.data.length) return { success: false, message: '您已申请过该物品' }

  const res = await db.collection(COL.applications).add({
    data: {
      _openid: openid,
      itemId,
      itemTitle: itemTitle || '',
      applicantNickName: applicantNickName || '匿名',
      applicantAvatarUrl: applicantAvatarUrl || '',
      message: message.trim(),
      status: 'pending',
      createTime: db.serverDate()
    }
  })
  return { success: true, id: res._id }
}

// 我申请过的物品（通过 applications 关联）
async function myApply(openid) {
  const apps = await db.collection(COL.applications).where({ _openid: openid }).orderBy('createTime', 'desc').get()
  const itemIds = [...new Set(apps.data.map(a => a.itemId))]
  if (!itemIds.length) return { success: true, list: [] }
  const itemsRes = await db.collection(COL.items).where({ _id: _.in(itemIds) }).get()
  const list = itemsRes.data.map(it => {
    const app = apps.data.find(a => a.itemId === it._id)
    return Object.assign({}, it, { applyStatus: app ? app.status : 'none' })
  })
  return { success: true, list }
}

// 某物品的申请记录（仅发布者可见）
async function getApplications(event, openid) {
  const { itemId } = event
  const itemRes = await db.collection(COL.items).doc(itemId).get()
  if (!itemRes.data || itemRes.data._openid !== openid) {
    return { success: false, message: '无权查看申请记录' }
  }
  const apps = await db.collection(COL.applications).where({ itemId }).orderBy('createTime', 'desc').get()
  return { success: true, list: apps.data }
}

// 发布者处理申请：approve=接受并标记完成；reject=拒绝；complete=直接标记完成
async function handleApply(event, openid) {
  const { itemId, applicationId, action } = event
  const itemRes = await db.collection(COL.items).doc(itemId).get()
  if (!itemRes.data || itemRes.data._openid !== openid) {
    return { success: false, message: '无权操作该物品' }
  }

  if (action === 'approve' && applicationId) {
    await db.collection(COL.items).doc(itemId).update({ data: { status: 'completed', completeTime: db.serverDate() } })
    await db.collection(COL.applications).where({ itemId, _id: applicationId }).update({ data: { status: 'approved' } })
    await db.collection(COL.applications).where({ itemId, _id: _.neq(applicationId) }).update({ data: { status: 'rejected' } })
    await addPoints(openid, 10, 1)
  } else if (action === 'complete') {
    await db.collection(COL.items).doc(itemId).update({ data: { status: 'completed', completeTime: db.serverDate() } })
    await addPoints(openid, 10, 1)
  } else if (action === 'reject' && applicationId) {
    await db.collection(COL.applications).where({ itemId, _id: applicationId }).update({ data: { status: 'rejected' } })
  } else {
    return { success: false, message: '未知操作' }
  }
  return { success: true }
}

// 举报
async function report(event, openid) {
  const { itemId, itemTitle, reason } = event
  if (!itemId) return { success: false, message: '物品ID缺失' }
  if (!reason || !reason.trim()) return { success: false, message: '请填写举报理由' }
  const textCheck = await checkText(reason, openid)
  if (!textCheck.passed) return { success: false, code: 'CONTENT_RISK', message: textCheck.message }
  await db.collection(COL.reports).add({
    data: {
      _openid: openid,
      itemId,
      itemTitle: itemTitle || '',
      reason: reason.trim(),
      status: 'pending',
      result: '',
      createTime: db.serverDate()
    }
  })
  return { success: true }
}

// 处理举报（管理员 或 物品发布者）：offline=下架物品并标记相关举报已处理；ignore=忽略单条举报
async function handleReport(event, openid) {
  const { itemId, reportId, action } = event
  if (!itemId) return { success: false, message: '物品ID缺失' }
  const itemRes = await db.collection(COL.items).doc(itemId).get()
  if (!itemRes.data) return { success: false, message: '物品不存在' }
  const isOwner = itemRes.data._openid === openid
  const isAdmin = await isAdminUser(openid)
  if (!isOwner && !isAdmin) return { success: false, message: '无权处理该举报' }

  if (action === 'offline') {
    if (itemRes.data.status === 'completed') return { success: false, message: '该物品已送出，无需下架' }
    await db.collection(COL.items).doc(itemId).update({ data: { status: 'offline' } })
    await db.collection(COL.reports).where({ itemId, status: 'pending' }).update({
      data: { status: 'handled', result: 'offline', handleTime: db.serverDate() }
    })
  } else if (action === 'ignore') {
    if (!reportId) return { success: false, message: '举报ID缺失' }
    await db.collection(COL.reports).doc(reportId).update({
      data: { status: 'handled', result: 'ignored', handleTime: db.serverDate() }
    })
  } else {
    return { success: false, message: '未知操作' }
  }
  return { success: true }
}

// 管理员：拉取全部举报（含物品当前状态）
async function adminReports(openid) {
  if (!(await isAdminUser(openid))) return { success: false, message: '无管理员权限' }
  const reports = await db.collection(COL.reports).orderBy('createTime', 'desc').limit(100).get()
  const itemIds = [...new Set(reports.data.map(r => r.itemId))]
  const itemMap = {}
  if (itemIds.length) {
    const items = await db.collection(COL.items).where({ _id: _.in(itemIds) }).get()
    items.data.forEach(it => { itemMap[it._id] = it })
  }
  const list = reports.data.map(r => {
    const it = itemMap[r.itemId]
    return Object.assign({}, r, {
      itemStatus: it ? it.status : 'deleted',
      itemTitle: (it && it.title) || r.itemTitle || '(物品已删除)'
    })
  })
  return { success: true, list }
}

// 管理员验证：输入正确密钥后，将当前用户标记为管理员
async function becomeAdmin(event, openid) {
  const { secret } = event
  if (!secret || secret !== ADMIN_SECRET) return { success: false, message: '管理密钥不正确' }
  const users = await db.collection(COL.users).where({ _openid: openid }).get()
  if (users.data.length === 0) return { success: false, message: '请先登录后再验证' }
  await db.collection(COL.users).doc(users.data[0]._id).update({ data: { isAdmin: true } })
  return { success: true }
}

// 查询当前用户是否管理员
async function checkIsAdmin(openid) {
  return { success: true, isAdmin: await isAdminUser(openid) }
}

// 我提交的举报（举报者查看受理结果，含物品状态）
async function myReports(openid) {
  const reports = await db.collection(COL.reports).where({ _openid: openid }).orderBy('createTime', 'desc').get()
  const itemIds = [...new Set(reports.data.map(r => r.itemId))]
  const itemMap = {}
  if (itemIds.length) {
    const items = await db.collection(COL.items).where({ _id: _.in(itemIds) }).get()
    items.data.forEach(it => { itemMap[it._id] = it })
  }
  const list = reports.data.map(r => {
    const it = itemMap[r.itemId]
    return Object.assign({}, r, {
      itemStatus: it ? it.status : 'deleted',
      itemTitle: (it && it.title) || r.itemTitle || '(物品已删除)'
    })
  })
  return { success: true, list }
}

// 首页统计
async function getStats() {
  const available = await db.collection(COL.items).where({ status: 'available' }).count()
  const completed = await db.collection(COL.items).where({ status: 'completed' }).count()
  return { success: true, availableCount: available.total, completedCount: completed.total }
}

// ===================== 入口 =====================
exports.main = async (event, context) => {
  const { action } = event
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  try {
    await ensureCollections()
    switch (action) {
      case 'login': return await login(event, openid)
      case 'publish': return await publish(event, openid)
      case 'list': return await listItems(event)
      case 'detail': return await getItemDetail(event, openid)
      case 'update': return await updateItem(event, openid)
      case 'setStatus': return await setStatus(event, openid)
      case 'delete': return await deleteItem(event, openid)
      case 'myPublish': return await myPublish(openid, event)
      case 'apply': return await apply(event, openid)
      case 'myApply': return await myApply(openid)
      case 'applications': return await getApplications(event, openid)
      case 'handleApply': return await handleApply(event, openid)
      case 'report': return await report(event, openid)
      case 'handleReport': return await handleReport(event, openid)
      case 'adminReports': return await adminReports(openid)
      case 'myReports': return await myReports(openid)
      case 'becomeAdmin': return await becomeAdmin(event, openid)
      case 'isAdmin': return await checkIsAdmin(openid)
      case 'stats': return await getStats()
      default: return { success: false, message: '未知操作: ' + action }
    }
  } catch (e) {
    console.error('campusApi error:', e)
    return { success: false, message: '服务器异常: ' + (e.message || e.errMsg || '未知错误') }
  }
}
