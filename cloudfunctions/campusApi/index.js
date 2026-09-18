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
  users: 'users',
  conversations: 'conversations',
  messages: 'messages',
  favorites: 'favorites',
  follows: 'follows',
  searchLogs: 'search_logs', // P2：搜索热词日志
  pointLogs: 'point_logs',    // P1：积分明细流水
  checkins: 'checkins',        // P3：每日签到
  feedbacks: 'feedbacks'       // 意见反馈
}

// 微信订阅消息模板 ID（需在 mp.weixin.qq.com → 订阅消息 中申请对应模板后填入）
// 目前为占位符：申请/处理结果通知需要用户自行配置模板后填写真实 ID
const SUBSCRIBE_TEMPLATES = {
  applyNotice: 'KONb9VrH39tCvnNZmDedUM3AwUoF94-jqaLKfzcvqeA',      // 物品被申请时通知发布者（如"申请结果通知"类模板）
  applyResult: 'Abrj1ds3NiI04kR2EoTEcg83gIFXYdlgTa7MY1fKUYA',      // 申请被处理时通知申请者
  reportResult: 'Jw1n_Vaw6W73fSuz72b9MGu15kWRwYwoQuo-aba1-_M'      // 举报处理结果通知举报者
}

// 管理员识别（二选一命中即为管理员）：
// 1. ADMIN_OPENIDS 白名单（推荐，登录即管理员，无需任何操作）
// 2. users 集合 isAdmin 标记（旧的「输入密钥」方式写入，保留兼容）
// 把你的 openid 填入下方数组即可，如 ['oXxx...', 'oYyy...']
const ADMIN_OPENIDS = []

// 管理员密钥：已废弃的前端「输入密钥」流程保留的后门，仅供日后给协管员授权使用。
const ADMIN_SECRET = 'EFULQegQtvthmjFR6TXY'

// 首次请求时确保集合存在（免去手动建库）。集合已存在时 createCollection 抛错，忽略即可。
let collectionsReady = false
async function ensureCollections() {
  if (collectionsReady) return
  for (const name of [COL.items, COL.applications, COL.reports, COL.users, COL.conversations, COL.messages, COL.favorites, COL.follows, COL.searchLogs, COL.pointLogs, COL.checkins, COL.feedbacks]) {
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

// 给发布者增加积分，并写入积分流水（P1：激励信用）
async function addPoints(openid, points, donateCount, reason, itemTitle) {
  const users = await db.collection(COL.users).where({ _openid: openid }).get()
  if (!users.data.length) return
  const u = users.data[0]
  await db.collection(COL.users).doc(u._id).update({
    data: { points: _.inc(points), donateCount: _.inc(donateCount) }
  })
  // 积分流水（失败不影响加分）
  try {
    await db.collection(COL.pointLogs).add({
      data: {
        _openid: openid,
        points: points,
        donateCount: donateCount || 0,
        reason: reason || '公益行为',
        itemTitle: itemTitle || '',
        createTime: db.serverDate()
      }
    })
  } catch (e) { /* 日志失败忽略 */ }
}

// 判断当前用户是否管理员（白名单 openid 或 users 集合 isAdmin 标记）
async function isAdminUser(openid) {
  if (!openid) return false
  if (ADMIN_OPENIDS.includes(openid)) return true
  const res = await db.collection(COL.users).where({ _openid: openid, isAdmin: true }).get()
  return res.data.length > 0
}

// ===================== 订阅消息 =====================

// 发送订阅消息（一次性订阅）。模板未配置或发送失败时不阻断主流程，仅记录日志。
async function sendSubscribeMessage(templateId, touser, page, data) {
  if (!templateId) return { sent: false, reason: 'template_not_configured' }
  try {
    const res = await cloud.openapi.subscribeMessage.send({
      touser: touser,
      page: page || 'pages/index/index',
      lang: 'zh_CN',
      data: data,
      miniprogramState: 'formal'
    })
    if (res.errCode === 0) return { sent: true }
    // 43101: 用户未订阅/订阅次数用尽，属正常业务状态，不报错
    if (res.errCode === 43101) return { sent: false, reason: 'not_subscribed' }
    return { sent: false, reason: 'err_' + res.errCode }
  } catch (e) {
    console.warn('subscribeMessage.send 失败:', e)
    return { sent: false, reason: 'exception' }
  }
}

// 发布者确认送出/完成时通知申请者（模板「审核结果通知」：thing1=审核内容、phrase1=审核结果、time1=审核时间）
async function notifyApplyResult(openid, touser, itemTitle, statusText) {
  if (!touser) return
  await sendSubscribeMessage(SUBSCRIBE_TEMPLATES.applyResult, touser, 'pages/index/index', {
    thing1: { value: (itemTitle || '').slice(0, 20) },
    phrase1: { value: (statusText || '已处理').slice(0, 5) },
    time1: { value: getNowStr() }
  })
}

// 物品被申请时通知发布者（模板「申请审核提醒」：thing1=用户昵称、thing2=申请原因、time1=申请时间）
async function notifyApplyNotice(openid, touser, applicantNickName, applyMessage) {
  if (!touser) return
  await sendSubscribeMessage(SUBSCRIBE_TEMPLATES.applyNotice, touser, 'pages/index/index', {
    thing1: { value: (applicantNickName || '某同学').slice(0, 20) },
    thing2: { value: (applyMessage || '有人申请了你的物品').slice(0, 20) },
    time1: { value: getNowStr() }
  })
}

// 举报处理结果通知举报者（模板「举报结果通知」：thing1=举报内容、phrase1=处理进度、time1=处理日期）
async function notifyReportResult(openid, touser, reportReason, resultText) {
  if (!touser) return
  await sendSubscribeMessage(SUBSCRIBE_TEMPLATES.reportResult, touser, 'pages/index/index', {
    thing1: { value: (reportReason || '举报内容').slice(0, 20) },
    phrase1: { value: (resultText || '已处理').slice(0, 5) },
    time1: { value: getNowStr() }
  })
}

function getNowStr() {
  const d = new Date()
  const p = n => (n < 10 ? '0' + n : '' + n)
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
}

// ===================== 会话与消息 =====================

// 创建/获取申请人与发布者之间的会话（幂等：同物品同申请人复用已有会话）
async function getOrCreateConversation(openid, itemId, applicantNickName, applicantAvatarUrl, item) {
  const exist = await db.collection(COL.conversations).where({ itemId, applicantOpenid: openid }).get()
  if (exist.data.length) {
    const conv = exist.data[0]
    await db.collection(COL.conversations).doc(conv._id).update({
      data: { ownerOpenid: item._openid, lastMessage: '', lastTime: db.serverDate() }
    })
    return conv
  }
  const res = await db.collection(COL.conversations).add({
    data: {
      _openid: openid,
      itemId,
      itemTitle: item.title || '',
      itemImage: (item.images && item.images[0]) || '',
      itemStatus: item.status || 'available',
      applicantOpenid: openid,
      ownerOpenid: item._openid,
      applicantNickName: applicantNickName || '匿名',
      applicantAvatarUrl: applicantAvatarUrl || '',
      ownerNickName: item.publisherNickName || '匿名',
      ownerAvatarUrl: item.publisherAvatarUrl || '',
      lastMessage: '',
      lastTime: db.serverDate(),
      createTime: db.serverDate()
    }
  })
  const doc = await db.collection(COL.conversations).doc(res._id).get()
  return doc.data
}

// 我的会话列表（我作为申请方或发布方），按最近消息时间倒序
async function myConversations(openid) {
  const asApplicant = await db.collection(COL.conversations).where({ applicantOpenid: openid }).orderBy('lastTime', 'desc').limit(100).get()
  const asOwner = await db.collection(COL.conversations).where({ ownerOpenid: openid }).orderBy('lastTime', 'desc').limit(100).get()

  const seen = {}
  const list = []
  const both = asApplicant.data.concat(asOwner.data)
  for (const c of both) {
    if (seen[c._id]) continue
    seen[c._id] = true
    // 计算未读数：对方发给我的未读消息
    const unread = await db.collection(COL.messages)
      .where({ convId: c._id, toOpenid: openid, read: false }).count()
    list.push({
      id: c._id,
      itemId: c.itemId,
      itemTitle: c.itemTitle,
      itemImage: c.itemImage,
      itemStatus: c.itemStatus,
      isOwner: c.ownerOpenid === openid,
      peerName: c.ownerOpenid === openid ? (c.applicantNickName || '申请者') : (c.ownerNickName || '发布者'),
      peerAvatar: c.ownerOpenid === openid ? (c.applicantAvatarUrl || '') : (c.ownerAvatarUrl || ''),
      lastMessage: c.lastMessage || '',
      lastTime: c.lastTime,
      lastTimeStr: formatServerTime(c.lastTime),
      unreadCount: unread.total
    })
  }
  // 排序：按 lastTime 倒序
  list.sort((a, b) => (b.lastTime && b.lastTime.$date || b.lastTime) - (a.lastTime && a.lastTime.$date || a.lastTime))
  return { success: true, list }
}

// 我的未读消息总数（供消息 Tab 角标 / 首页红点）
async function unreadCount(openid) {
  if (!openid) return { success: true, count: 0 }
  const res = await db.collection(COL.messages)
    .where({ toOpenid: openid, read: false }).count()
  return { success: true, count: res.total }
}

function formatServerTime(t) {
  if (!t) return ''
  let ms = typeof t === 'object' ? (t.$date || t.getTime()) : t
  if (!ms) return ''
  const d = new Date(ms)
  const p = n => (n < 10 ? '0' + n : '' + n)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return p(d.getHours()) + ':' + p(d.getMinutes())
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
}

// 会话消息列表（仅会话双方可看），并自动将对方发给我的消息标记已读
async function conversationMessages(event, openid) {
  const { convId } = event
  if (!convId) return { success: false, message: '会话ID缺失' }
  const convRes = await db.collection(COL.conversations).doc(convId).get()
  const conv = convRes.data
  if (!conv) return { success: false, message: '会话不存在' }
  if (conv.applicantOpenid !== openid && conv.ownerOpenid !== openid) {
    return { success: false, message: '无权查看该会话' }
  }
  const msgs = await db.collection(COL.messages)
    .where({ convId }).orderBy('createTime', 'asc').limit(200).get()
  const list = msgs.data.map(m => ({
    id: m._id,
    fromOpenid: m.fromOpenid,
    toOpenid: m.toOpenid,
    content: m.content,
    createTime: m.createTime,
    createTimeStr: formatServerTime(m.createTime),
    isMine: m.fromOpenid === openid,
    read: m.read
  }))
  // 标记已读（对方发给我的）
  await db.collection(COL.messages).where({ convId, toOpenid: openid, read: false })
    .update({ data: { read: true } })
  return {
    success: true,
    list,
    role: conv.applicantOpenid === openid ? 'applicant' : 'owner',
    peerName: conv.ownerOpenid === openid ? conv.applicantNickName : conv.ownerNickName,
    peerAvatar: conv.ownerOpenid === openid ? (conv.applicantAvatarUrl || '') : (conv.ownerAvatarUrl || ''),
    itemTitle: conv.itemTitle
  }
}

// 发送消息（仅会话双方可发；申请者在发布者回复前最多发一条）
async function sendMessage(event, openid) {
  const { convId, content } = event
  if (!convId) return { success: false, message: '会话ID缺失' }
  const text = (content || '').trim()
  if (!text) return { success: false, message: '消息不能为空' }
  if (text.length > 500) return { success: false, message: '消息过长' }

  const textCheck = await checkText(text, openid)
  if (!textCheck.passed) return { success: false, code: 'CONTENT_RISK', message: textCheck.message }

  const convRes = await db.collection(COL.conversations).doc(convId).get()
  const conv = convRes.data
  if (!conv) return { success: false, message: '会话不存在' }
  if (conv.applicantOpenid !== openid && conv.ownerOpenid !== openid) {
    return { success: false, message: '无权在该会话发言' }
  }
  const toOpenid = conv.ownerOpenid === openid ? conv.applicantOpenid : conv.ownerOpenid

  // 申请者限发规则：发布者回复前，申请者最多发一条（类抖音私信）
  if (conv.applicantOpenid === openid) {
    const ownerReplied = await db.collection(COL.messages)
      .where({ convId, fromOpenid: conv.ownerOpenid }).count()
    if (ownerReplied.total === 0) {
      const mySent = await db.collection(COL.messages)
        .where({ convId, fromOpenid: openid }).count()
      if (mySent.total >= 1) {
        return { success: false, code: 'LIMIT_ONE', message: '发布者回复前仅可发送一条消息' }
      }
    }
  }

  const res = await db.collection(COL.messages).add({
    data: {
      _openid: openid,
      convId,
      fromOpenid: openid,
      toOpenid,
      content: text,
      read: false,
      createTime: db.serverDate()
    }
  })
  await db.collection(COL.conversations).doc(convId).update({
    data: { lastMessage: text, lastTime: db.serverDate() }
  })
  return { success: true, id: res._id }
}

// ===================== 收藏与关注 =====================

// 切换收藏状态（收藏/取消收藏）
async function toggleFavorite(event, openid) {
  const { itemId } = event
  if (!itemId) return { success: false, message: '物品ID缺失' }
  const exist = await db.collection(COL.favorites).where({ _openid: openid, itemId }).get()
  if (exist.data.length) {
    await db.collection(COL.favorites).doc(exist.data[0]._id).remove()
    return { success: true, favorited: false }
  }
  const itemRes = await db.collection(COL.items).doc(itemId).get()
  const item = itemRes.data
  if (!item) return { success: false, message: '物品不存在' }
  await db.collection(COL.favorites).add({
    data: {
      _openid: openid,
      itemId,
      itemTitle: item.title || '',
      itemImage: (item.images && item.images[0]) || '',
      itemStatus: item.status || 'available',
      createTime: db.serverDate()
    }
  })
  return { success: true, favorited: true }
}

// 我的收藏列表
async function myFavorites(openid) {
  const res = await db.collection(COL.favorites).where({ _openid: openid }).orderBy('createTime', 'desc').limit(100).get()
  return { success: true, list: res.data.map(f => Object.assign({}, f, { id: f._id, favorited: true })) }
}

// 物品收藏状态（供详情页按钮展示）
async function favoriteStatus(event, openid) {
  const { itemId } = event
  if (!itemId) return { success: false, message: '物品ID缺失' }
  const exist = await db.collection(COL.favorites).where({ _openid: openid, itemId }).get()
  return { success: true, favorited: exist.data.length > 0 }
}

// 切换关注状态（关注/取关发布者）
async function toggleFollow(event, openid) {
  const { targetOpenid } = event
  if (!targetOpenid) return { success: false, message: '关注对象缺失' }
  if (targetOpenid === openid) return { success: false, message: '不能关注自己' }
  const exist = await db.collection(COL.follows).where({ _openid: openid, targetOpenid }).get()
  if (exist.data.length) {
    await db.collection(COL.follows).doc(exist.data[0]._id).remove()
    return { success: true, followed: false }
  }
  const u = await db.collection(COL.users).where({ _openid: targetOpenid }).get()
  await db.collection(COL.follows).add({
    data: {
      _openid: openid,
      targetOpenid,
      targetNickName: u.data.length ? (u.data[0].nickName || '用户') : '用户',
      createTime: db.serverDate()
    }
  })
  return { success: true, followed: true }
}

// 我的关注列表
async function myFollows(openid) {
  const res = await db.collection(COL.follows).where({ _openid: openid }).orderBy('createTime', 'desc').limit(100).get()
  return { success: true, list: res.data.map(f => Object.assign({}, f, { id: f._id, followed: true })) }
}

// 是否已关注某发布者（供详情页按钮展示）
async function followStatus(event, openid) {
  const { targetOpenid } = event
  if (!targetOpenid) return { success: false, message: '关注对象缺失' }
  const exist = await db.collection(COL.follows).where({ _openid: openid, targetOpenid }).get()
  return { success: true, followed: exist.data.length > 0 }
}

// ===================== P1：激励信用 =====================

// 我的积分明细（含积分/捐赠/原因/时间，倒序）
async function myPointLogs(openid) {
  const logs = await db.collection(COL.pointLogs)
    .where({ _openid: openid })
    .orderBy('createTime', 'desc')
    .limit(100)
    .get()
  return {
    success: true,
    list: logs.data.map(l => ({
      id: l._id,
      points: l.points || 0,
      donateCount: l.donateCount || 0,
      reason: l.reason || '公益行为',
      itemTitle: l.itemTitle || '',
      createTime: l.createTime,
      createTimeStr: formatServerTime(l.createTime)
    }))
  }
}

// 公益排行榜：积分 Top N + 捐赠次数 Top N（排除封禁用户）
async function rankList() {
  const byPoints = await db.collection(COL.users)
    .where({ status: _.neq('banned') })
    .orderBy('points', 'desc')
    .limit(10)
    .get()
  const byDonate = await db.collection(COL.users)
    .where({ status: _.neq('banned') })
    .orderBy('donateCount', 'desc')
    .limit(10)
    .get()
  const pick = u => ({
    openid: u._openid,
    nickName: u.nickName || '公益参与者',
    avatarUrl: u.avatarUrl || '',
    points: u.points || 0,
    donateCount: u.donateCount || 0
  })
  return {
    success: true,
    byPoints: byPoints.data.map(pick),
    byDonate: byDonate.data.map(pick)
  }
}

// ===================== P3：体验运营（签到） =====================

// 东八区日期字符串 yyyy-mm-dd（偏移 n 天）
function dateKey(offsetDays) {
  const d = new Date(Date.now() + 8 * 3600 * 1000 + (offsetDays || 0) * 86400000)
  const p = n => (n < 10 ? '0' + n : '' + n)
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate())
}

// 签到状态：今日是否已签 / 连续天数 / 近7天日历
async function checkInStatus(openid) {
  if (!openid) return { success: true, signed: false, streak: 0, week: [] }
  const today = dateKey(0)
  const todayRes = await db.collection(COL.checkins).where({ _openid: openid, date: today }).get()
  const users = await db.collection(COL.users).where({ _openid: openid }).get()
  const streak = users.data.length ? (users.data[0].streak || 0) : 0
  // 近 7 天
  const week = []
  const days = []
  for (let i = 6; i >= 0; i--) days.push(dateKey(-i))
  const logs = await db.collection(COL.checkins).where({ _openid: openid, date: _.in(days) }).get()
  const signedSet = new Set(logs.data.map(l => l.date))
  for (const d of days) {
    week.push({ date: d, label: d.slice(5), signed: signedSet.has(d), isToday: d === today })
  }
  return { success: true, signed: todayRes.data.length > 0, streak, week }
}

// 执行签到：+2 积分；连续满 7 天额外 +5（激励连续参与）
async function checkIn(openid) {
  if (!openid) return { success: false, message: '登录后即可签到' }
  const today = dateKey(0)
  const exist = await db.collection(COL.checkins).where({ _openid: openid, date: today }).get()
  if (exist.data.length) return { success: false, message: '今日已签到' }

  const users = await db.collection(COL.users).where({ _openid: openid }).get()
  let streak = 1
  let bonus = 0
  if (users.data.length) {
    const u = users.data[0]
    const yesterday = dateKey(-1)
    streak = (u.lastCheckInDate === yesterday) ? (u.streak || 0) + 1 : 1
    // 连续满 7 天（及每满 7 天）额外 +5
    if (streak > 0 && streak % 7 === 0) bonus = 5
  }
  const points = 2 + bonus

  await db.collection(COL.checkins).add({
    data: { _openid: openid, date: today, createTime: db.serverDate() }
  })
  if (users.data.length) {
    await db.collection(COL.users).doc(users.data[0]._id).update({
      data: { lastCheckInDate: today, streak, points: _.inc(points) }
    })
    try {
      await db.collection(COL.pointLogs).add({
        data: {
          _openid: openid,
          points: points,
          donateCount: 0,
          reason: bonus > 0 ? '连续签到满7天' : '每日签到',
          itemTitle: '',
          createTime: db.serverDate()
        }
      })
    } catch (e) { /* 忽略 */ }
  }
  return { success: true, points, streak, bonus }
}

// 意见反馈：内容 + 联系方式（选填），写入 feedbacks 集合
async function submitFeedback(event, openid) {
  const { content, contact } = event
  if (!content || !content.trim()) return { success: false, message: '反馈内容不能为空' }
  if (content.trim().length > 500) return { success: false, message: '反馈内容不能超过500字' }
  const textCheck = await checkText(content.trim(), openid)
  if (!textCheck.passed) return { success: false, code: 'CONTENT_RISK', message: textCheck.message }
  await db.collection(COL.feedbacks).add({
    data: {
      _openid: openid,
      content: content.trim(),
      contact: (contact || '').trim(),
      status: 'pending', // pending | read
      createTime: db.serverDate()
    }
  })
  return { success: true }
}

// ===================== 各 Action 实现 =====================

// 登录 / 同步用户资料
async function login(event, openid) {
  const { nickName, avatarUrl } = event
  const users = await db.collection(COL.users).where({ _openid: openid }).get()
  if (users.data.length === 0) {
    await db.collection(COL.users).add({
      data: { _openid: openid, nickName: nickName || '公益参与者', avatarUrl: avatarUrl || '', bio: '', region: '', points: 0, donateCount: 0, status: 'normal', createTime: db.serverDate() }
    })
    return { success: true, openid, nickName: nickName || '公益参与者', avatarUrl: avatarUrl || '', bio: '', region: '', points: 0, donateCount: 0, isAdmin: await isAdminUser(openid) }
  } else {
    const u = users.data[0]
    await db.collection(COL.users).doc(u._id).update({
      data: { nickName: nickName || '公益参与者', avatarUrl: avatarUrl || '' }
    })
    return { success: true, openid, nickName: u.nickName || '公益参与者', avatarUrl: u.avatarUrl || '', bio: u.bio || '', region: u.region || '', points: u.points || 0, donateCount: u.donateCount || 0, isAdmin: await isAdminUser(openid) }
  }
}

// 更新个人资料（昵称/头像/简介/地区）
async function updateProfile(event, openid) {
  const { nickName, avatarUrl, bio, region } = event
  const users = await db.collection(COL.users).where({ _openid: openid }).get()
  if (!users.data.length) return { success: false, message: '用户不存在' }
  const data = {}
  if (nickName !== undefined) {
    const name = (nickName || '').trim()
    if (!name) return { success: false, message: '昵称不能为空' }
    const tc = await checkText(name, openid)
    if (!tc.passed) return { success: false, code: 'CONTENT_RISK', message: tc.message }
    data.nickName = name
  }
  if (avatarUrl !== undefined) data.avatarUrl = avatarUrl || ''
  if (bio !== undefined) {
    if (bio.length > 100) return { success: false, message: '简介不能超过100字' }
    const bc = await checkText(bio.trim(), openid)
    if (!bc.passed) return { success: false, code: 'CONTENT_RISK', message: bc.message }
    data.bio = bio.trim()
  }
  if (region !== undefined) {
    if (region.length > 30) return { success: false, message: '地区信息过长' }
    data.region = region.trim()
  }
  await db.collection(COL.users).doc(users.data[0]._id).update({ data })
  return { success: true }
}

// 个人主页：用户公开资料 + 关注/粉丝数 + 发布的物品列表
async function userProfile(event, openid) {
  const target = (event && event.openid) || openid
  const users = await db.collection(COL.users).where({ _openid: target }).get()
  if (!users.data.length) return { success: false, message: '用户不存在' }
  const u = users.data[0]
  const [followCnt, fanCnt, itemsRes] = await Promise.all([
    db.collection(COL.follows).where({ _openid: target }).count(),
    db.collection(COL.follows).where({ targetOpenid: target }).count(),
    db.collection(COL.items).where({ _openid: target }).orderBy('createTime', 'desc').limit(50).get()
  ])
  const items = itemsRes.data.map(it => ({
    id: it._id,
    title: it.title,
    image: (it.images && it.images[0]) || '',
    category: it.category || 'other',
    status: it.status,
    allowBarter: !!it.allowBarter,
    createTime: it.createTime
  }))
  return {
    success: true,
    user: {
      openid: target,
      nickName: u.nickName || '公益参与者',
      avatarUrl: u.avatarUrl || '',
      bio: u.bio || '',
      region: u.region || '',
      points: u.points || 0,
      donateCount: u.donateCount || 0
    },
    followCount: followCnt.total,
    fanCount: fanCnt.total,
    items
  }
}

// 用户是否被封禁（封禁后仅可浏览，禁止发布/申请/举报等写操作）
async function isBannedUser(openid) {
  if (!openid) return false
  try {
    const res = await db.collection(COL.users).where({ _openid: openid }).get()
    return res.data.length > 0 && res.data[0].status === 'banned'
  } catch (e) {
    return false
  }
}

// 发布物品（含内容安全审核）
async function publish(event, openid) {
  if (await isBannedUser(openid)) return { success: false, message: '账号已被封禁，无法发布物品' }
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
  // P1：发布物品 +2 公益积分
  try {
    await addPoints(openid, 2, 0, '发布物品', title.trim())
  } catch (e) { /* 加分失败不影响发布 */ }
  return { success: true, id: res._id }
}

// 物品列表（分页 + 分类/关键词/仅看可换筛选 + 热门排序），默认只返回 available
async function listItems(event) {
  const { category = 'all', page = 1, pageSize = 10, status = 'available', keyword = '', barterOnly = false, sort = 'new' } = event
  const conditions = []
  if (category !== 'all') conditions.push({ category })
  if (status) conditions.push({ status })
  if (barterOnly) conditions.push({ allowBarter: true })
  const kw = (keyword || '').trim()
  if (kw) {
    conditions.push({ title: db.RegExp({ regexp: kw, options: 'i' }) })
    // P2：记录搜索热词（异步，不阻塞主流程）
    try {
      await db.collection(COL.searchLogs).add({
        data: { keyword: kw, createTime: db.serverDate() }
      })
    } catch (e) { /* 搜索日志失败不影响搜索 */ }
  }
  let q = db.collection(COL.items)
  if (conditions.length) q = q.where(_.and(conditions))
  const countRes = await q.count()
  let listRes
  if (sort === 'hot') {
    listRes = await q.orderBy('heat', 'desc').orderBy('createTime', 'desc')
      .skip((page - 1) * pageSize).limit(pageSize).get()
  } else {
    listRes = await q.orderBy('createTime', 'desc')
      .skip((page - 1) * pageSize).limit(pageSize).get()
  }
  return {
    success: true,
    // 隐私：列表不返回发布者 openid，仅展示昵称/头像（详情接口单独返回给需要校验的场景）
    list: listRes.data.map(it => {
      const { _openid, ...rest } = it
      return rest
    }),
    total: countRes.total,
    hasMore: page * pageSize < countRes.total
  }
}

// P2：搜索热词榜（近 30 天按搜索次数倒序，取前 10，避免历史旧词永久霸榜）
async function hotKeywords() {
  const since = new Date(Date.now() - 30 * 86400000)
  const agg = await db.collection(COL.searchLogs).aggregate()
    .match({ createTime: _.gte(since) })
    .group({ _id: '$keyword', count: _.sum(1) })
    .sort({ count: -1 })
    .limit(10)
    .end()
  return {
    success: true,
    list: (agg.list || []).map(k => ({ keyword: k._id, count: k.count }))
  }
}

// 物品详情（含是否本人发布；本人可见该物品举报记录；申请者可见申请状态）
async function getItemDetail(event, openid) {
  const { id } = event
  if (!id) return { success: false, message: '物品ID缺失' }
  const res = await db.collection(COL.items).doc(id).get()
  if (!res.data) return { success: false, message: '物品不存在' }
  // P2：浏览量 +1（heat 热度字段同步累加，用于热门排序）
  try {
    await db.collection(COL.items).doc(id).update({
      data: { viewCount: _.inc(1), heat: _.inc(1) }
    })
    res.data.viewCount = (res.data.viewCount || 0) + 1
    res.data.heat = (res.data.heat || 0) + 1
  } catch (e) { /* 计数失败不影响详情 */ }
  const isOwner = res.data._openid === openid
  let reports = []
  if (isOwner) {
    const r = await db.collection(COL.reports).where({ itemId: id }).orderBy('createTime', 'desc').get()
    reports = r.data
  }
  // 当前用户是否申请过该物品（用于前端"已申请"状态展示，避免重复申请）
  let hasApplied = false
  let applyStatus = ''
  if (openid) {
    const appRes = await db.collection(COL.applications).where({ itemId: id, _openid: openid }).limit(1).get()
    if (appRes.data.length) {
      hasApplied = true
      applyStatus = appRes.data[0].status || 'pending'
    }
  }
  // P2：猜你喜欢 —— 同分类可领取物品（排除本物品，按热度降序取 6 条）
  let related = []
  try {
    const relatedRes = await db.collection(COL.items)
      .where(_.and([
        { category: res.data.category || 'other' },
        { status: 'available' },
        { _id: _.neq(id) }
      ]))
      .orderBy('heat', 'desc')
      .limit(6)
      .get()
    related = relatedRes.data
  } catch (e) { /* 推荐失败不影响详情 */ }
  return { success: true, item: res.data, isOwner, reports, hasApplied, applyStatus, related }
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
  await db.collection(COL.favorites).where({ itemId: id }).remove()
  // 级联清理会话与消息（messages.convId 指向会话 _id，需先查会话再删）
  try {
    const convRes = await db.collection(COL.conversations).where({ itemId: id }).get()
    const convIds = convRes.data.map(c => c._id)
    if (convIds.length) {
      await db.collection(COL.messages).where({ convId: _.in(convIds) }).remove()
    }
    await db.collection(COL.conversations).where({ itemId: id }).remove()
  } catch (e) { /* 清理失败不影响删除 */ }
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
  if (await isBannedUser(openid)) return { success: false, message: '账号已被封禁，无法申请物品' }
  const { itemId, message, itemTitle, applicantNickName, applicantAvatarUrl } = event
  if (!itemId) return { success: false, message: '物品ID缺失' }
  if (!message || !message.trim()) return { success: false, message: '请填写申请留言' }

  const textCheck = await checkText(message, openid)
  if (!textCheck.passed) return { success: false, code: 'CONTENT_RISK', message: textCheck.message }

  const exist = await db.collection(COL.applications).where({ itemId, _openid: openid }).get()
  if (exist.data.length) return { success: false, message: '您已申请过该物品' }

  // 校验物品存在且处于可领取状态（禁止对已送出/已下架/已删除物品申请）
  const itemCheck = await db.collection(COL.items).doc(itemId).get()
  if (!itemCheck.data) return { success: false, message: '物品不存在' }
  if (itemCheck.data.status !== 'available') return { success: false, message: '该物品当前不可申请' }

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

  // 自动创建/复用会话，方便双方在站内消息中沟通（P0 新能力）
  try {
    const itemRes = await db.collection(COL.items).doc(itemId).get()
    if (itemRes.data) {
      await getOrCreateConversation(openid, itemId, applicantNickName, applicantAvatarUrl, itemRes.data)
      // 把申请留言作为第一条消息写入会话
      const convRes = await db.collection(COL.conversations).where({ itemId, applicantOpenid: openid }).get()
      if (convRes.data.length) {
        await db.collection(COL.messages).add({
          data: {
            _openid: openid,
            convId: convRes.data[0]._id,
            fromOpenid: openid,
            toOpenid: itemRes.data._openid,
            content: '【申请留言】' + message.trim(),
            read: false,
            createTime: db.serverDate()
          }
        })
        await db.collection(COL.conversations).doc(convRes.data[0]._id).update({
          data: { lastMessage: '【申请留言】' + message.trim(), lastTime: db.serverDate() }
        })
      }
      // 订阅消息：通知发布者"物品被申请"
      await notifyApplyNotice(openid, itemRes.data._openid, applicantNickName, message.trim())
    }
  } catch (e) {
    console.warn('创建会话失败（不影响申请）:', e)
  }

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
  // 防刷分：已完成的物品不可重复确认送出/完成（否则会重复加积分）
  if (itemRes.data.status === 'completed') {
    return { success: false, message: '该物品已送出，请勿重复操作' }
  }

  if (action === 'approve' && applicationId) {
    await db.collection(COL.items).doc(itemId).update({ data: { status: 'completed', completeTime: db.serverDate() } })
    await db.collection(COL.applications).where({ itemId, _id: applicationId }).update({ data: { status: 'approved' } })
    await db.collection(COL.applications).where({ itemId, _id: _.neq(applicationId) }).update({ data: { status: 'rejected' } })
    await addPoints(openid, 10, 1, '物品成功送出', itemRes.data.title)
    // P1：被选中的申请者 +5 积分（激励主动申领）
    const appRes = await db.collection(COL.applications).doc(applicationId).get()
    if (appRes.data) {
      await addPoints(appRes.data._openid, 5, 0, '申请被选中', itemRes.data.title)
      await notifyApplyResult(openid, appRes.data._openid, itemRes.data.title, '申请已通过')
    }
  } else if (action === 'complete') {
    await db.collection(COL.items).doc(itemId).update({ data: { status: 'completed', completeTime: db.serverDate() } })
    await addPoints(openid, 10, 1, '物品成功送出', itemRes.data.title)
  } else if (action === 'reject' && applicationId) {
    await db.collection(COL.applications).where({ itemId, _id: applicationId }).update({ data: { status: 'rejected' } })
    const appRes = await db.collection(COL.applications).doc(applicationId).get()
    if (appRes.data) await notifyApplyResult(openid, appRes.data._openid, itemRes.data.title, '申请未通过')
  } else {
    return { success: false, message: '未知操作' }
  }
  return { success: true }
}

// 举报
async function report(event, openid) {
  if (await isBannedUser(openid)) return { success: false, message: '账号已被封禁，无法举报' }
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
    const offlineRes = await db.collection(COL.reports).where({ itemId, status: 'pending' }).update({
      data: { status: 'handled', result: 'offline', handleTime: db.serverDate() }
    })
    // 订阅消息：通知举报者"已下架"
    if (offlineRes.stats && offlineRes.stats.updated > 0) {
      const rep = await db.collection(COL.reports).where({ itemId, status: 'handled' }).orderBy('handleTime', 'desc').limit(1).get()
      if (rep.data.length) {
        await notifyReportResult(openid, rep.data[0]._openid, rep.data[0].reason, '已下架')
        // P1：举报核实有效（物品下架）→ 举报者 +2 公益积分
        await addPoints(rep.data[0]._openid, 2, 0, '举报有效', itemRes.data.title)
      }
    }
  } else if (action === 'ignore') {
    if (!reportId) return { success: false, message: '举报ID缺失' }
    await db.collection(COL.reports).doc(reportId).update({
      data: { status: 'handled', result: 'ignored', handleTime: db.serverDate() }
    })
    // 订阅消息：通知该条举报者"已忽略"
    const repRes = await db.collection(COL.reports).doc(reportId).get()
    if (repRes.data) await notifyReportResult(openid, repRes.data._openid, repRes.data.reason, '已忽略')
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

// ===================== 管理后台（管理员专用） =====================

// 数据总览：核心运营指标
async function adminStats(openid) {
  if (!(await isAdminUser(openid))) return { success: false, message: '无管理员权限' }
  const [userCnt, itemCnt, availCnt, completedCnt, offlineCnt, appCnt, reportCnt, pendingReportCnt, bannedCnt] = await Promise.all([
    db.collection(COL.users).count(),
    db.collection(COL.items).count(),
    db.collection(COL.items).where({ status: 'available' }).count(),
    db.collection(COL.items).where({ status: 'completed' }).count(),
    db.collection(COL.items).where({ status: 'offline' }).count(),
    db.collection(COL.applications).count(),
    db.collection(COL.reports).count(),
    db.collection(COL.reports).where({ status: 'pending' }).count(),
    db.collection(COL.users).where({ status: 'banned' }).count()
  ])
  // 分类分布（用于管理看板）
  const cats = ['books', 'clothes', 'electronics', 'other']
  const catCounts = {}
  for (const c of cats) {
    const r = await db.collection(COL.items).where({ status: 'available', category: c }).count()
    catCounts[c] = r.total
  }
  // P2：近 7 天发布趋势（按天统计 createTime）
  const dayLabels = []
  const dayCounts = []
  {
    const now = new Date()
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000)
      const label = (d.getMonth() + 1) + '-' + d.getDate()
      dayLabels.push(label)
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate())
      const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
      const r = await db.collection(COL.items)
        .where(_.and([{ createTime: _.gte(start) }, { createTime: _.lt(end) }]))
        .count()
      dayCounts.push(r.total)
    }
  }
  return {
    success: true,
    stats: {
      userCount: userCnt.total,
      itemCount: itemCnt.total,
      availableCount: availCnt.total,
      completedCount: completedCnt.total,
      offlineCount: offlineCnt.total,
      applicationCount: appCnt.total,
      reportCount: reportCnt.total,
      pendingReportCount: pendingReportCnt.total,
      bannedCount: bannedCnt.total,
      categoryCounts: catCounts,
      trendDays: dayLabels,
      trendCounts: dayCounts
    }
  }
}

// 全部物品管理（分页 + 状态筛选 + 关键词）
async function adminItems(event, openid) {
  if (!(await isAdminUser(openid))) return { success: false, message: '无管理员权限' }
  const { page = 1, pageSize = 20, status = '', keyword = '' } = event
  const conditions = []
  if (status) conditions.push({ status })
  if (keyword && keyword.trim()) conditions.push({ title: db.RegExp({ regexp: keyword.trim(), options: 'i' }) })
  let q = db.collection(COL.items)
  if (conditions.length) q = q.where(_.and(conditions))
  const countRes = await q.count()
  const listRes = await q.orderBy('createTime', 'desc').skip((page - 1) * pageSize).limit(pageSize).get()
  return {
    success: true,
    list: listRes.data,
    total: countRes.total,
    hasMore: page * pageSize < countRes.total
  }
}

// 管理员下架 / 重新上架物品（completed 不可变更）
async function adminSetItemStatus(event, openid) {
  if (!(await isAdminUser(openid))) return { success: false, message: '无管理员权限' }
  const { id, status } = event
  if (!id) return { success: false, message: '物品ID缺失' }
  if (status !== 'available' && status !== 'offline') return { success: false, message: '无效的状态' }
  const res = await db.collection(COL.items).doc(id).get()
  if (!res.data) return { success: false, message: '物品不存在' }
  if (res.data.status === 'completed') return { success: false, message: '已送出的物品不可变更状态' }
  await db.collection(COL.items).doc(id).update({ data: { status } })
  return { success: true, status }
}

// 管理员删除物品（级联清理申请/举报/收藏/会话/消息）
async function adminDeleteItem(event, openid) {
  if (!(await isAdminUser(openid))) return { success: false, message: '无管理员权限' }
  const { id } = event
  if (!id) return { success: false, message: '物品ID缺失' }
  const res = await db.collection(COL.items).doc(id).get()
  if (!res.data) return { success: false, message: '物品不存在' }
  await db.collection(COL.items).doc(id).remove()
  await db.collection(COL.applications).where({ itemId: id }).remove()
  await db.collection(COL.reports).where({ itemId: id }).remove()
  await db.collection(COL.favorites).where({ itemId: id }).remove()
  // 先查该物品的所有会话 ID，再按 convId 清理消息（messages.convId 是会话 _id，不是物品 ID）
  try {
    const convRes = await db.collection(COL.conversations).where({ itemId: id }).get()
    const convIds = convRes.data.map(c => c._id)
    if (convIds.length) {
      await db.collection(COL.messages).where({ convId: _.in(convIds) }).remove()
    }
    await db.collection(COL.conversations).where({ itemId: id }).remove()
  } catch (e) { /* 清理失败不影响删除 */ }
  return { success: true }
}

// 用户列表（分页 + 关键词昵称搜索）
async function adminUsers(event, openid) {
  if (!(await isAdminUser(openid))) return { success: false, message: '无管理员权限' }
  const { page = 1, pageSize = 20, keyword = '' } = event
  let q = db.collection(COL.users)
  if (keyword && keyword.trim()) {
    q = q.where({ nickName: db.RegExp({ regexp: keyword.trim(), options: 'i' }) })
  }
  const countRes = await q.count()
  const listRes = await q.orderBy('createTime', 'desc').skip((page - 1) * pageSize).limit(pageSize).get()
  const list = listRes.data.map(u => Object.assign({}, u, {
    id: u._id,
    isAdminUser: !!(u.isAdmin || false),
    statusText: u.status === 'banned' ? '已封禁' : '正常',
    createTimeStr: formatServerTime(u.createTime)
  }))
  return { success: true, list, total: countRes.total, hasMore: page * pageSize < countRes.total }
}

// 封禁 / 解封用户（封禁后不能发布/申请/举报）
async function adminBanUser(event, openid) {
  if (!(await isAdminUser(openid))) return { success: false, message: '无管理员权限' }
  const { userId, ban } = event
  if (!userId) return { success: false, message: '用户ID缺失' }
  const res = await db.collection(COL.users).doc(userId).get()
  if (!res.data) return { success: false, message: '用户不存在' }
  if (res.data._openid === openid) return { success: false, message: '不能封禁自己' }
  await db.collection(COL.users).doc(userId).update({ data: { status: ban ? 'banned' : 'normal' } })
  return { success: true, status: ban ? 'banned' : 'normal' }
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
      case 'hotKeywords': return await hotKeywords()
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
      case 'myConversations': return await myConversations(openid)
      case 'unreadCount': return await unreadCount(openid)
      case 'conversationMessages': return await conversationMessages(event, openid)
      case 'sendMessage': return await sendMessage(event, openid)
      case 'toggleFavorite': return await toggleFavorite(event, openid)
      case 'myFavorites': return await myFavorites(openid)
      case 'favoriteStatus': return await favoriteStatus(event, openid)
      case 'toggleFollow': return await toggleFollow(event, openid)
      case 'myFollows': return await myFollows(openid)
      case 'followStatus': return await followStatus(event, openid)
      case 'pointLogs': return await myPointLogs(openid)
      case 'rankList': return await rankList()
      case 'checkInStatus': return await checkInStatus(openid)
      case 'checkIn': return await checkIn(openid)
      case 'submitFeedback': return await submitFeedback(event, openid)
      case 'updateProfile': return await updateProfile(event, openid)
      case 'userProfile': return await userProfile(event, openid)
      case 'adminStats': return await adminStats(openid)
      case 'adminItems': return await adminItems(event, openid)
      case 'adminSetItemStatus': return await adminSetItemStatus(event, openid)
      case 'adminDeleteItem': return await adminDeleteItem(event, openid)
      case 'adminUsers': return await adminUsers(event, openid)
      case 'adminBanUser': return await adminBanUser(event, openid)
      default: return { success: false, message: '未知操作: ' + action }
    }
  } catch (e) {
    console.error('campusApi error:', e)
    return { success: false, message: '服务器异常: ' + (e.message || e.errMsg || '未知错误') }
  }
}
