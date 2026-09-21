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
  feedbacks: 'feedbacks',       // 意见反馈
  keywordSubs: 'keywordSubs',   // P1：关键词到货提醒订阅
  certificates: 'certificates', // P4：电子公益证书
  evaluations: 'evaluations',   // P5：完成捐赠双方互评
  wishes: 'wishes',              // P6：心愿求购
  blacklists: 'blacklists',      // P7：拉黑
  badges: 'badges',              // P7：已兑换徽章
  lotteries: 'lotteries'         // P7：抽奖记录
}

// 积分商城：公益徽章目录（P7 积分消费出口）
const BADGES = [
  { id: 'eco', name: '环保卫士', icon: '🌱', price: 20, desc: '完成1次物品流转，为地球减负' },
  { id: 'helper', name: '公益帮手', icon: '🤝', price: 50, desc: '累计捐赠3件闲置物品' },
  { id: 'star', name: '校园公益之星', icon: '⭐', price: 100, desc: '累计捐赠10件闲置物品' },
  { id: 'legend', name: '公益传奇', icon: '🏆', price: 200, desc: '平台的公益精神图腾' }
]

// 微信订阅消息模板 ID（需在 mp.weixin.qq.com → 订阅消息 中申请对应模板后填入）
// 目前为占位符：申请/处理结果通知需要用户自行配置模板后填写真实 ID
const SUBSCRIBE_TEMPLATES = {
  applyNotice: 'KONb9VrH39tCvnNZmDedUM3AwUoF94-jqaLKfzcvqeA',      // 物品被申请时通知发布者
  applyResult: 'Abrj1ds3NiI04kR2EoTEcg83gIFXYdlgTa7MY1fKUYA',      // 申请被处理时通知申请者
  reportResult: 'Jw1n_Vaw6W73fSuz72b9MGu15kWRwYwoQuo-aba1-_M',      // 举报处理结果通知举报者
  arrivalNotice: 'icMSGnd8DDchZFkOYOHPjSyRulR4EA8wKl72gUq5COw'      // 新物品到货提醒（关键词订阅）
}

// 管理员识别（二选一命中即为管理员）：
// 1. ADMIN_OPENIDS 白名单（推荐，登录即管理员，无需任何操作）
// 2. users 集合 isAdmin 标记（旧的「输入密钥」方式写入，保留兼容）
// 把你的 openid 填入下方数组即可，如 ['oXxx...', 'oYyy...']
const ADMIN_OPENIDS = []

// 管理员密钥：已废弃的前端「输入密钥」流程保留的后门，仅供日后给协管员授权使用。
// 安全改善：优先读取云开发环境变量 ADMIN_SECRET（云开发控制台 → 云函数 → 配置 → 环境变量）。
// 若未配置环境变量则密钥校验不可用（避免密钥出现在公开仓库）。建议同时把 openid 填入 ADMIN_OPENIDS 白名单。
const ADMIN_SECRET = process.env.ADMIN_SECRET || ''

// 内容安全严格模式：SECURITY_STRICT=true 时，若 msgSecCheck/imgSecCheck 服务未开通或调用失败，直接拒绝发布/申请等写操作；
// 默认 false（开发期兜底放行，生产环境务必开通内容安全并建议开启严格模式）。
const SECURITY_STRICT = process.env.SECURITY_STRICT === 'true'

// 首次请求时确保集合存在（免去手动建库）。集合已存在时 createCollection 抛错，忽略即可。
let collectionsReady = false
async function ensureCollections() {
  if (collectionsReady) return
  for (const name of [COL.items, COL.applications, COL.reports, COL.users, COL.conversations, COL.messages, COL.favorites, COL.follows, COL.searchLogs, COL.pointLogs, COL.checkins, COL.feedbacks, COL.certificates, COL.evaluations, COL.wishes, COL.blacklists, COL.badges, COL.lotteries, COL.keywordSubs]) {
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
    // 未开通内容安全服务或调用失败：严格模式下拒绝（生产建议开启），默认开发期放行
    console.error('msgSecCheck 调用失败（请确认已开通内容安全）:', e)
    return { passed: !SECURITY_STRICT, message: '内容安全服务不可用，请稍后重试' }
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

// 积分等级名称（P1 五级激励）
function levelName(points) {
  if (points >= 500) return '公益大使'
  if (points >= 300) return '公益先锋'
  if (points >= 150) return '公益达人'
  if (points >= 50) return '公益使者'
  return '初心者'
}

// 给发布者增加积分，并写入积分流水（P1：激励信用；points 可为负数——积分消费）
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
      data: data
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

// 创建/获取会话（幂等：同一物品/求购 + 同一申请人复用已有会话）
// ref: { itemId?, wishId?, title, image, status, ownerOpenid, ownerNickName, ownerAvatarUrl }（物品会话或求购会话二选一）
async function getOrCreateConversation(openid, ref, applicantNickName, applicantAvatarUrl) {
  const whereCond = ref.wishId
    ? { wishId: ref.wishId, applicantOpenid: openid }
    : { itemId: ref.itemId, applicantOpenid: openid }
  const exist = await db.collection(COL.conversations).where(whereCond).get()
  if (exist.data.length) {
    const conv = exist.data[0]
    await db.collection(COL.conversations).doc(conv._id).update({
      data: { ownerOpenid: ref.ownerOpenid, lastMessage: '', lastTime: db.serverDate() }
    })
    return conv
  }
  const res = await db.collection(COL.conversations).add({
    data: {
      _openid: openid,
      itemId: ref.itemId || null,
      wishId: ref.wishId || null,
      itemTitle: ref.title || '',
      itemImage: ref.image || '',
      itemStatus: ref.status || 'available',
      applicantOpenid: openid,
      ownerOpenid: ref.ownerOpenid,
      applicantNickName: applicantNickName || '匿名',
      applicantAvatarUrl: applicantAvatarUrl || '',
      ownerNickName: ref.ownerNickName || '匿名',
      ownerAvatarUrl: ref.ownerAvatarUrl || '',
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
  // 改善：一次性查出关联物品的实时状态，修正会话快照（物品已删则保留快照）
  const itemIds = [...new Set(both.map(c => c.itemId).filter(Boolean))]
  const itemMap = {}
  if (itemIds.length) {
    try {
      const items = await db.collection(COL.items).where({ _id: _.in(itemIds) }).get()
      items.data.forEach(i => { itemMap[i._id] = i })
    } catch (e) {}
  }
  for (const c of both) {
    if (seen[c._id]) continue
    seen[c._id] = true
    // 计算未读数：对方发给我的未读消息
    const unread = await db.collection(COL.messages)
      .where({ convId: c._id, toOpenid: openid, read: false }).count()
    const liveItem = itemMap[c.itemId]
    list.push({
      id: c._id,
      itemId: c.itemId,
      wishId: c.wishId || '',
      itemTitle: c.itemTitle,
      itemImage: c.itemImage,
      itemStatus: liveItem ? liveItem.status : c.itemStatus,
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
    peerOpenid: conv.ownerOpenid === openid ? conv.applicantOpenid : conv.ownerOpenid,
    peerName: conv.ownerOpenid === openid ? conv.applicantNickName : conv.ownerNickName,
    peerAvatar: conv.ownerOpenid === openid ? (conv.applicantAvatarUrl || '') : (conv.ownerAvatarUrl || ''),
    itemTitle: conv.itemTitle,
    wishId: conv.wishId || ''
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

  // P7：拉黑校验——任一方拉黑另一方，双方均不能再发消息
  if (await hasBlockRelation(openid, toOpenid)) {
    return { success: false, message: '你们已处于拉黑状态，无法发送消息' }
  }

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

// 我的收藏列表（改善：关联物品实时状态；物品已删除的收藏不再展示，避免点进"物品不存在"）
async function myFavorites(openid) {
  const res = await db.collection(COL.favorites).where({ _openid: openid }).orderBy('createTime', 'desc').limit(100).get()
  const favs = res.data
  const itemIds = [...new Set(favs.map(f => f.itemId).filter(Boolean))]
  const itemMap = {}
  if (itemIds.length) {
    try {
      const items = await db.collection(COL.items).where({ _id: _.in(itemIds) }).get()
      items.data.forEach(i => { itemMap[i._id] = i })
    } catch (e) {}
  }
  const list = favs
    .filter(f => itemMap[f.itemId])
    .map(f => Object.assign({}, f, {
      id: f._id,
      favorited: true,
      itemStatus: itemMap[f.itemId].status,
      itemTitle: itemMap[f.itemId].title || f.itemTitle,
      itemImage: (itemMap[f.itemId].images && itemMap[f.itemId].images[0]) || f.itemImage
    }))
  return { success: true, list }
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
    .where({ status: _.neq('banned'), points: _.gt(0) })
    .orderBy('points', 'desc')
    .limit(10)
    .get()
  const byDonate = await db.collection(COL.users)
    .where({ status: _.neq('banned'), donateCount: _.gt(0) })
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

// 日历页：查询某用户某月已签到的日期列表
async function checkinMonth(event, openid) {
  if (!openid) return { success: false, message: '登录后查看' }
  // month 格式 'YYYY-MM'，默认当前月
  const now = new Date(Date.now() + 8 * 3600 * 1000)
  const month = (event && event.month) || (now.getUTCFullYear() + '-' + String(now.getUTCMonth() + 1).padStart(2, '0'))
  const start = month + '-01'
  // 取下月1号作为结束
  const [y, m] = month.split('-').map(Number)
  const end = (m === 12) ? (y + 1) + '-01-01' : y + '-' + String(m + 1).padStart(2, '0') + '-01'
  const res = await db.collection(COL.checkins)
    .where({ _openid: openid, date: _.gte(start), date: _.lt(end) })
    .get()
  // 累计签到总次数
  const totalRes = await db.collection(COL.checkins).where({ _openid: openid }).count()
  return {
    success: true,
    month,
    signedDates: res.data.map(r => r.date),
    total: totalRes.total
  }
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
  const { nickName, avatarUrl, inviteBy } = event
  const users = await db.collection(COL.users).where({ _openid: openid }).get()
  if (users.data.length === 0) {
    await db.collection(COL.users).add({
      data: { _openid: openid, nickName: nickName || '公益参与者', avatarUrl: avatarUrl || '', bio: '', region: '', points: 0, donateCount: 0, credit: 100, status: 'normal', createTime: db.serverDate() }
    })
    // P2：邀请好友奖励——新用户首次登录，邀请人和新人各+5分
    if (inviteBy && inviteBy !== openid) {
      try {
        const inviter = await db.collection(COL.users).where({ _openid: inviteBy }).get()
        if (inviter.data.length) {
          await db.collection(COL.users).doc(inviter.data[0]._id).update({ data: { points: _.inc(5) } })
          try {
            await db.collection(COL.pointLogs).add({
              data: { _openid: inviteBy, points: 5, donateCount: 0, reason: '邀请好友注册', itemTitle: '', createTime: db.serverDate() }
            })
          } catch (e) {}
          await addPoints(openid, 5, 0, '好友邀请奖励', '通过好友邀请注册')
        }
      } catch (e) { /* 邀请奖励失败不影响登录 */ }
    }
    return { success: true, openid, nickName: nickName || '公益参与者', avatarUrl: avatarUrl || '', bio: '', region: '', points: 0, donateCount: 0, credit: 100, isAdmin: await isAdminUser(openid) }
  } else {
    const u = users.data[0]
    // 老用户补 credit 默认值
    if (u.credit == null) {
      try { await db.collection(COL.users).doc(u._id).update({ data: { credit: 100 } }) } catch (e) {}
    }
    // 改善：不再用前端传入值覆盖昵称/头像（防止多设备旧缓存覆盖云端新值），返回云端权威资料
    return { success: true, openid, nickName: u.nickName || '公益参与者', avatarUrl: u.avatarUrl || '', bio: u.bio || '', region: u.region || '', points: u.points || 0, donateCount: u.donateCount || 0, credit: u.credit != null ? u.credit : 100, status: u.status || 'normal', title: u.title || '', isAdmin: await isAdminUser(openid) }
  }
}

// 更新个人资料（昵称/头像/简介/地区）；记录不存在时自动创建（upsert）
async function updateProfile(event, openid) {
  const { nickName, avatarUrl, bio, region } = event
  const users = await db.collection(COL.users).where({ _openid: openid }).get()
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
  if (users.data.length) {
    await db.collection(COL.users).doc(users.data[0]._id).update({ data })
  } else {
    // 自动补建用户记录（本地有缓存但云端记录丢失的场景）
    await db.collection(COL.users).add({
      data: {
        _openid: openid,
        nickName: data.nickName || '公益参与者',
        avatarUrl: data.avatarUrl || '',
        bio: data.bio || '',
        region: data.region || '',
        points: 0, donateCount: 0, credit: 100, status: 'normal',
        createTime: db.serverDate()
      }
    })
  }
  return { success: true }
}

// 个人主页：用户公开资料 + 关注/粉丝数 + 发布的物品列表 + 收到的评价（P5）
async function userProfile(event, openid) {
  const target = (event && event.openid) || openid
  const users = await db.collection(COL.users).where({ _openid: target }).get()
  if (!users.data.length) return { success: false, message: '用户不存在' }
  const u = users.data[0]
  const [followCnt, fanCnt, itemsRes, evalRes] = await Promise.all([
    db.collection(COL.follows).where({ _openid: target }).count(),
    db.collection(COL.follows).where({ targetOpenid: target }).count(),
    db.collection(COL.items).where({ _openid: target }).orderBy('createTime', 'desc').limit(50).get(),
    db.collection(COL.evaluations).where({ toOpenid: target }).orderBy('createTime', 'desc').limit(20).get()
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
  const evaluations = evalRes.data.map(ev => ({
    id: ev._id,
    rating: ev.rating || 5,
    comment: ev.comment || '',
    fromNickName: ev.fromNickName || '同学',
    itemTitle: ev.itemTitle || '',
    createTimeStr: formatServerTime(ev.createTime)
  }))
  const avgRating = evaluations.length
    ? (evaluations.reduce((s, e) => s + e.rating, 0) / evaluations.length).toFixed(1)
    : '0'
  const user = {
    openid: target,
    nickName: u.nickName || '公益参与者',
    avatarUrl: u.avatarUrl || '',
    bio: u.bio || '',
    region: u.region || '',
    points: u.points || 0,
    donateCount: u.donateCount || 0,
    credit: u.credit != null ? u.credit : 100,
    title: u.title || '',
    evaluationCount: evaluations.length,
    avgRating: Number(avgRating)
  }
  return {
    success: true,
    user,
    // 平铺到顶层，兼容前端 res.points / res.nickName 等直接读取
    ...user,
    followCount: followCnt.total,
    fanCount: fanCnt.total,
    items,
    evaluations
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

  // P1：查询与该物品匹配的开放求购数量（同分类 + 标题关键词重合）
  let matchWishCount = 0
  try {
    const catWishes = await db.collection(COL.wishes).where({ status: 'open', category: category || 'other' }).count()
    const titleWords = (title || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ').split(/\s+/).filter(w => w.length >= 2)
    let kwWishes = 0
    if (titleWords.length) {
      kwWishes = await db.collection(COL.wishes)
        .where({ status: 'open', title: db.RegExp({ regexp: titleWords.join('|'), options: 'i' }) })
        .count().catch(() => ({ total: 0 }))
      kwWishes = kwWishes.total || 0
    }
    matchWishCount = Math.max(catWishes.total || 0, kwWishes)
  } catch (e) { matchWishCount = 0 }

  // P1：通知订阅了相关关键词的用户（投影+并发+上限保护）
  try {
    const titleStr = (title || '').toLowerCase()
    const subs = await db.collection(COL.keywordSubs)
      .field({ keyword: true, _openid: true })
      .limit(200)
      .get()
    const notified = new Set()
    const tasks = []
    for (const s of subs.data) {
      if (s._openid === openid) continue
      if (notified.has(s._openid)) continue
      if (titleStr.indexOf((s.keyword || '').toLowerCase()) >= 0) {
        notified.add(s._openid)
        tasks.push(() => sendSubscribeMessage(SUBSCRIBE_TEMPLATES.arrivalNotice, s._openid, 'pages/detail/detail?id=' + res._id, {
          thing1: { value: (title || '').slice(0, 20) },
          thing2: { value: '您订阅的关键词有新匹配' },
          time1: { value: getNowStr() }
        }))
      }
    }
    // 并发发送，最多一批10个，避免云函数超时
    const batch = 10
    for (let i = 0; i < tasks.length; i += batch) {
      await Promise.all(tasks.slice(i, i + batch).map(fn => fn()))
    }
  } catch (e) { /* 通知失败不影响发布 */ }

  return { success: true, id: res._id, matchWishCount }
}

// 物品列表（分页 + 分类/关键词/仅看可换筛选 + 热门排序），默认只返回 available
async function listItems(event) {
  // P7：惰性处理超时未确认的赠送（3天未确认→物品重新上架）
  await expireOverdueConfirmations()
  const { category = 'all', page = 1, pageSize = 10, status = 'available', keyword = '', barterOnly = false, sort = 'new' } = event
  const conditions = []
  if (category !== 'all') conditions.push({ category })
  if (status) conditions.push({ status })
  if (barterOnly) conditions.push({ allowBarter: true })
  const kw = (keyword || '').trim()
  if (kw) {
    conditions.push({ title: db.RegExp({ regexp: kw, options: 'i' }) })
    // P2：记录搜索热词（仅首页首次搜索 page=1 时记录，避免分页/轮询重复计数）
    if (!page || page === 1) {
      try {
        await db.collection(COL.searchLogs).add({
          data: { keyword: kw, createTime: db.serverDate() }
        })
      } catch (e) { /* 搜索日志失败不影响搜索 */ }
    }
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
  // P7：置顶物品排最前（topUntil 未过期，仅对"最新"排序生效，避免热榜被置顶干扰）
  let arr = listRes.data
  if (sort !== 'hot') {
    const now = Date.now()
    arr = [...arr].sort((x, y) => {
      const xt = x.topUntil && new Date(x.topUntil).getTime() > now ? 1 : 0
      const yt = y.topUntil && new Date(y.topUntil).getTime() > now ? 1 : 0
      return (yt - xt) || (new Date(y.createTime) - new Date(x.createTime))
    })
  }
  return {
    success: true,
    // 隐私：列表不返回发布者 openid，仅展示昵称/头像（详情接口单独返回给需要校验的场景）
    list: arr.map(it => {
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
  // P7：惰性处理超时未确认的赠送
  await expireOverdueConfirmations()
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
  let applyId = ''
  if (openid) {
    const appRes = await db.collection(COL.applications).where({ itemId: id, _openid: openid }).limit(1).get()
    if (appRes.data.length) {
      hasApplied = true
      applyStatus = appRes.data[0].status || 'pending'
      applyId = appRes.data[0]._id
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
  return { success: true, item: res.data, isOwner, reports, hasApplied, applyStatus, applyId, related }
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
  // P7：惰性处理超时未确认的赠送
  await expireOverdueConfirmations()
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

  // P7：拉黑校验——任一方拉黑另一方，不能申请其物品
  if (await hasBlockRelation(openid, itemCheck.data._openid)) {
    return { success: false, message: '你们已处于拉黑状态，无法申请该物品' }
  }

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
      await getOrCreateConversation(openid, {
        itemId,
        title: itemRes.data.title,
        image: (itemRes.data.images && itemRes.data.images[0]) || '',
        status: itemRes.data.status,
        ownerOpenid: itemRes.data._openid,
        ownerNickName: itemRes.data.publisherNickName,
        ownerAvatarUrl: itemRes.data.publisherAvatarUrl
      }, applicantNickName, applicantAvatarUrl)
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
  // 注意：云数据库默认单次最多返回 20 条，必须显式 limit
  const apps = await db.collection(COL.applications).where({ _openid: openid }).orderBy('createTime', 'desc').limit(100).get()
  const itemIds = [...new Set(apps.data.map(a => a.itemId))]
  if (!itemIds.length) return { success: true, list: [] }
  const itemsRes = await db.collection(COL.items).where({ _id: _.in(itemIds) }).get()
  const list = itemsRes.data.map(it => {
    const app = apps.data.find(a => a.itemId === it._id)
    return Object.assign({}, it, { applyStatus: app ? app.status : 'none' })
  })
  return { success: true, list }
}

// 某物品的申请记录（仅发布者可见；P7：关联申请人积分/等级，按积分降序排列——高积分公益人优先展示）
async function getApplications(event, openid) {
  const { itemId } = event
  await expireOverdueConfirmations()
  const itemRes = await db.collection(COL.items).doc(itemId).get()
  if (!itemRes.data || itemRes.data._openid !== openid) {
    return { success: false, message: '无权查看申请记录' }
  }
  const apps = await db.collection(COL.applications).where({ itemId }).orderBy('createTime', 'desc').limit(50).get()
  // 批量关联申请人积分/等级/信用
  const openids = [...new Set(apps.data.map(a => a._openid).filter(Boolean))]
  const userMap = {}
  if (openids.length) {
    try {
      const users = await db.collection(COL.users).where({ _openid: _.in(openids) }).get()
      users.data.forEach(u => { userMap[u._openid] = u })
    } catch (e) {}
  }
  const list = apps.data.map(a => {
    const u = userMap[a._openid] || {}
    return Object.assign({}, a, {
      id: a._id,
      applicantPoints: u.points || 0,
      applicantLevel: levelName(u.points || 0),
      applicantCredit: u.credit != null ? u.credit : 100
    })
  })
  // 积分降序，同分按申请时间早的在前
  list.sort((x, y) => (y.applicantPoints - x.applicantPoints) || (new Date(x.createTime) - new Date(y.createTime)))
  return { success: true, list }
}

// 生成电子公益证书（物品送出后自动创建，P4 亮点）
async function createCertificate(item) {
  try {
    const d = new Date(Date.now() + 8 * 3600 * 1000)
    const p = n => (n < 10 ? '0' + n : '' + n)
    const no = 'JH' + d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + '-' + Math.floor(1000 + Math.random() * 9000)
    await db.collection(COL.certificates).add({
      data: {
        _openid: item._openid,
        itemId: item._id,
        itemTitle: item.title || '',
        itemImage: (item.images && item.images[0]) || '',
        certNo: no,
        createTime: db.serverDate()
      }
    })
  } catch (e) { /* 证书生成失败不影响主流程 */ }
}

// 我的公益证书列表（P4 亮点）
async function myCertificates(openid) {
  const list = await db.collection(COL.certificates).where({ _openid: openid }).orderBy('createTime', 'desc').limit(50).get()
  return {
    success: true,
    list: list.data.map(c => ({
      id: c._id,
      certNo: c.certNo,
      itemTitle: c.itemTitle,
      itemImage: c.itemImage,
      createTime: c.createTime,
      createTimeStr: formatServerTime(c.createTime)
    }))
  }
}

// ===================== P5：完成捐赠互评 =====================

// 提交评价（仅已完成的物品，且仅限本次赠送的双方：发布者 或 被选中的申请者）
async function submitEvaluation(event, openid) {
  const { itemId, rating, comment } = event
  if (!itemId) return { success: false, message: '物品ID缺失' }
  const r = Number(rating)
  if (!r || r < 1 || r > 5) return { success: false, message: '请选择评分（1-5星）' }
  const commentText = (comment || '').trim()
  if (commentText.length > 200) return { success: false, message: '评语不能超过200字' }
  if (commentText) {
    const tc = await checkText(commentText, openid)
    if (!tc.passed) return { success: false, code: 'CONTENT_RISK', message: tc.message }
  }
  const itemRes = await db.collection(COL.items).doc(itemId).get()
  const item = itemRes.data
  if (!item) return { success: false, message: '物品不存在' }
  if (item.status !== 'completed') return { success: false, message: '仅已完成的物品可评价' }
  const isOwner = item._openid === openid

  // 确定评价对象（P7：approved=待确认、confirmed=已确认收到，均为有效参与方）
  let toOpenid = ''
  let toNickName = ''
  if (isOwner) {
    const app = await db.collection(COL.applications).where({ itemId, status: _.in(['approved', 'confirmed']) }).limit(1).get()
    if (!app.data.length) return { success: false, message: '未找到接收者' }
    toOpenid = app.data[0]._openid
    toNickName = app.data[0].applicantNickName || '同学'
  } else {
    // 非发布者必须是该物品被选中的申请者
    const app = await db.collection(COL.applications).where({ itemId, _openid: openid, status: _.in(['approved', 'confirmed']) }).get()
    if (!app.data.length) return { success: false, message: '仅参与本次赠送的双方可评价' }
    toOpenid = item._openid
    toNickName = item.publisherNickName || '发布者'
  }
  // 防重复评价
  const exist = await db.collection(COL.evaluations).where({ itemId, _openid: openid }).get()
  if (exist.data.length) return { success: false, message: '您已评价过该物品' }

  const my = await db.collection(COL.users).where({ _openid: openid }).get()
  const myName = my.data.length ? (my.data[0].nickName || '用户') : '用户'
  await db.collection(COL.evaluations).add({
    data: {
      _openid: openid,
      toOpenid,
      itemId,
      itemTitle: item.title || '',
      rating: r,
      comment: commentText,
      fromNickName: myName,
      createTime: db.serverDate()
    }
  })
  return { success: true, toNickName }
}

// 我是否已评价该物品（详情页评价入口显示）
async function evaluationStatus(event, openid) {
  const { itemId } = event
  if (!itemId) return { success: false, message: '物品ID缺失' }
  const exist = await db.collection(COL.evaluations).where({ itemId, _openid: openid }).get()
  return { success: true, evaluated: exist.data.length > 0 }
}

// 发布者处理申请：approve=确认送给该申请者（进入待确认状态）；reject=拒绝；complete=直接标记完成（兼容旧流程）
async function handleApply(event, openid) {
  const { itemId, applicationId, action } = event
  const itemRes = await db.collection(COL.items).doc(itemId).get()
  if (!itemRes.data || itemRes.data._openid !== openid) {
    return { success: false, message: '无权操作该物品' }
  }
  // 防刷分：已完成的物品不可重复确认送出/完成（否则会重复加积分）
  if (itemRes.data.status === 'completed' || itemRes.data.status === 'waiting_confirm') {
    return { success: false, message: '该物品已送出，请勿重复操作' }
  }

  if (action === 'approve' && applicationId) {
    // P7：送出 → 物品进入"待确认"状态，由申请者确认收到后才结算（防止虚假送出）
    await db.collection(COL.items).doc(itemId).update({ data: { status: 'waiting_confirm', completeTime: db.serverDate() } })
    await db.collection(COL.applications).where({ itemId, _id: applicationId }).update({ data: { status: 'approved', confirmTime: db.serverDate() } })
    const appRes = await db.collection(COL.applications).doc(applicationId).get()
    if (appRes.data) {
      await notifyApplyResult(openid, appRes.data._openid, itemRes.data.title, '待确认收到')
    }
  } else if (action === 'complete') {
    await db.collection(COL.items).doc(itemId).update({ data: { status: 'completed', completeTime: db.serverDate() } })
    await addPoints(openid, 10, 1, '物品成功送出', itemRes.data.title)
    // P4：送出即生成电子公益证书
    await createCertificate(itemRes.data)
  } else if (action === 'reject' && applicationId) {
    await db.collection(COL.applications).where({ itemId, _id: applicationId }).update({ data: { status: 'rejected' } })
    const appRes = await db.collection(COL.applications).doc(applicationId).get()
    if (appRes.data) await notifyApplyResult(openid, appRes.data._openid, itemRes.data.title, '申请未通过')
  } else {
    return { success: false, message: '未知操作' }
  }
  return { success: true }
}

// ===================== P7：确认收到 + 爽约信用 =====================

// 调整用户信用分（默认100起，爽约等失信行为扣减）
async function changeCredit(openid, delta) {
  try {
    const users = await db.collection(COL.users).where({ _openid: openid }).get()
    if (!users.data.length) return
    const u = users.data[0]
    const cur = u.credit != null ? u.credit : 100
    await db.collection(COL.users).doc(u._id).update({ data: { credit: Math.max(0, cur + delta) } })
  } catch (e) { /* 信用调整失败不影响主流程 */ }
}

// 申请者确认收到（P7）：物品由"待确认"转为"已完成"，此时才结算积分/证书/互评
async function confirmReceive(event, openid) {
  const { itemId, applicationId } = event
  if (!itemId || !applicationId) return { success: false, message: '参数缺失' }
  const appRes = await db.collection(COL.applications).doc(applicationId).get()
  const app = appRes.data
  if (!app || app.itemId !== itemId) return { success: false, message: '申请记录不存在' }
  if (app._openid !== openid) return { success: false, message: '仅申请者本人可确认收到' }
  if (app.status !== 'approved') return { success: false, message: '当前状态不可确认收到' }
  const itemRes = await db.collection(COL.items).doc(itemId).get()
  const item = itemRes.data
  if (!item || item.status !== 'waiting_confirm') return { success: false, message: '物品状态异常，无法确认' }

  await db.collection(COL.items).doc(itemId).update({ data: { status: 'completed', completeTime: db.serverDate() } })
  await db.collection(COL.applications).doc(applicationId).update({ data: { status: 'confirmed', confirmTime: db.serverDate() } })
  // 其余申请自动关闭（pending + 其他 approved）
  await db.collection(COL.applications).where({ itemId, status: 'pending' }).update({ data: { status: 'rejected' } })
  await db.collection(COL.applications).where({ itemId, status: 'approved', _openid: _.neq(openid) }).update({ data: { status: 'rejected' } })
  // 结算：发布者 +10 分/1 捐赠 + 证书；申请者 +5 分
  await addPoints(item._openid, 10, 1, '物品成功送出', item.title)
  await addPoints(openid, 5, 0, '申请被选中', item.title)
  await createCertificate(item)
  // 通知发布者：对方已确认收到
  await notifyApplyResult(openid, item._openid, item.title, '已确认收到')
  return { success: true }
}

// 惰性处理超时未确认（P7）：送出后 3 天内申请者未确认收到 → 判定爽约，物品恢复可领取，申请者信用 -20
async function expireOverdueConfirmations() {
  try {
    const limit = new Date(Date.now() - 3 * 24 * 3600 * 1000)
    const apps = await db.collection(COL.applications).where({ status: 'approved', confirmTime: _.lt(limit) }).limit(50).get()
    for (const a of apps.data) {
      await db.collection(COL.applications).doc(a._id).update({ data: { status: 'missed', missTime: db.serverDate() } })
      await db.collection(COL.items).doc(a.itemId).update({ data: { status: 'available' } })
      await changeCredit(a._openid, -20)
      // 通知双方（若曾订阅）
      const itemRes = await db.collection(COL.items).doc(a.itemId).get()
      if (itemRes.data) {
        await notifyApplyResult(a._openid, itemRes.data._openid, itemRes.data.title, '超时未确认')
      }
    }
  } catch (e) { /* 惰性处理失败不影响查询 */ }
}

// 举报（P7：支持举报物品 targetType=item 或举报用户 targetType=user）
async function report(event, openid) {
  if (await isBannedUser(openid)) return { success: false, message: '账号已被封禁，无法举报' }
  const { itemId, itemTitle, reason, targetType, targetOpenid, targetNickName } = event
  if (!reason || !reason.trim()) return { success: false, message: '请填写举报理由' }
  const textCheck = await checkText(reason, openid)
  if (!textCheck.passed) return { success: false, code: 'CONTENT_RISK', message: textCheck.message }
  const type = targetType === 'user' ? 'user' : 'item'
  if (type === 'item' && !itemId) return { success: false, message: '物品ID缺失' }
  if (type === 'user' && !targetOpenid) return { success: false, message: '举报对象缺失' }
  if (type === 'user' && targetOpenid === openid) return { success: false, message: '不能举报自己' }
  await db.collection(COL.reports).add({
    data: {
      _openid: openid,
      targetType: type,
      itemId: type === 'item' ? itemId : '',
      itemTitle: type === 'item' ? (itemTitle || '') : '',
      targetOpenid: type === 'user' ? targetOpenid : '',
      targetNickName: type === 'user' ? (targetNickName || '该用户') : '',
      reason: reason.trim(),
      status: 'pending',
      result: '',
      createTime: db.serverDate()
    }
  })
  return { success: true }
}

// ===================== P7c：拉黑 =====================

// 拉黑用户（A 拉黑 B：B 不能给 A 发消息、不能申请 A 的物品）
async function blockUser(event, openid) {
  const { targetOpenid } = event
  if (!targetOpenid) return { success: false, message: '参数缺失' }
  if (targetOpenid === openid) return { success: false, message: '不能拉黑自己' }
  const exist = await db.collection(COL.blacklists).where({ _openid: openid, targetOpenid }).get()
  if (!exist.data.length) {
    await db.collection(COL.blacklists).add({
      data: { _openid: openid, targetOpenid, createTime: db.serverDate() }
    })
  }
  return { success: true }
}

// 取消拉黑
async function unblockUser(event, openid) {
  const { targetOpenid } = event
  if (!targetOpenid) return { success: false, message: '参数缺失' }
  await db.collection(COL.blacklists).where({ _openid: openid, targetOpenid }).remove()
  return { success: true }
}

// 我的黑名单（含对方昵称头像）
async function myBlacklist(openid) {
  const list = await db.collection(COL.blacklists).where({ _openid: openid }).orderBy('createTime', 'desc').limit(50).get()
  const openids = [...new Set(list.data.map(b => b.targetOpenid))]
  const userMap = {}
  if (openids.length) {
    try {
      const users = await db.collection(COL.users).where({ _openid: _.in(openids) }).get()
      users.data.forEach(u => { userMap[u._openid] = u })
    } catch (e) {}
  }
  return {
    success: true,
    list: list.data.map(b => ({
      id: b._id,
      targetOpenid: b.targetOpenid,
      nickName: (userMap[b.targetOpenid] && userMap[b.targetOpenid].nickName) || '已注销用户',
      avatarUrl: (userMap[b.targetOpenid] && userMap[b.targetOpenid].avatarUrl) || '',
      createTimeStr: formatServerTime(b.createTime)
    }))
  }
}

// 我是否拉黑了对方 / 对方是否拉黑了我（聊天页、申请时校验）
async function blockStatus(event, openid) {
  const { targetOpenid } = event
  if (!targetOpenid) return { success: false, message: '参数缺失' }
  const mine = await db.collection(COL.blacklists).where({ _openid: openid, targetOpenid }).get()
  const theirs = await db.collection(COL.blacklists).where({ _openid: targetOpenid, targetOpenid: openid }).get()
  return {
    success: true,
    iBlocked: mine.data.length > 0,
    blockedBy: theirs.data.length > 0
  }
}

// 双方是否存在拉黑关系（内部，供 sendMessage / apply 使用）
async function hasBlockRelation(openidA, openidB) {
  try {
    const [ab, ba] = await Promise.all([
      db.collection(COL.blacklists).where({ _openid: openidA, targetOpenid: openidB }).count(),
      db.collection(COL.blacklists).where({ _openid: openidB, targetOpenid: openidA }).count()
    ])
    return ab.total > 0 || ba.total > 0
  } catch (e) {
    return false
  }
}

// 处理举报（管理员 或 物品发布者）：offline=下架物品并标记相关举报已处理；ignore=忽略单条举报（含用户举报）
async function handleReport(event, openid) {
  const { itemId, reportId, action } = event
  const isAdmin = await isAdminUser(openid)

  if (action === 'ignore') {
    if (!reportId) return { success: false, message: '举报ID缺失' }
    if (!isAdmin) {
      // 非管理员忽略单条举报：物品发布者可忽略本人物品的举报
      if (!itemId) return { success: false, message: '物品ID缺失' }
      const itemRes = await db.collection(COL.items).doc(itemId).get()
      if (!itemRes.data || itemRes.data._openid !== openid) return { success: false, message: '无权处理该举报' }
    }
    await db.collection(COL.reports).doc(reportId).update({
      data: { status: 'handled', result: 'ignored', handleTime: db.serverDate() }
    })
    // 订阅消息：通知该条举报者"已忽略"
    const repRes = await db.collection(COL.reports).doc(reportId).get()
    if (repRes.data) await notifyReportResult(openid, repRes.data._openid, repRes.data.reason, '已忽略')
    return { success: true }
  }

  // 以下分支需要 itemId（物品举报专用：下架）
  if (!itemId) return { success: false, message: '物品ID缺失' }
  const itemRes = await db.collection(COL.items).doc(itemId).get()
  if (!itemRes.data) return { success: false, message: '物品不存在' }
  const isOwner = itemRes.data._openid === openid
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
  } else {
    return { success: false, message: '未知操作' }
  }
  return { success: true }
}

// 管理员：拉取全部举报（含物品当前状态；P7：区分物品举报与用户举报）
async function adminReports(openid) {
  if (!(await isAdminUser(openid))) return { success: false, message: '无管理员权限' }
  const reports = await db.collection(COL.reports).orderBy('createTime', 'desc').limit(100).get()
  const itemIds = [...new Set(reports.data.map(r => r.itemId).filter(Boolean))]
  const itemMap = {}
  if (itemIds.length) {
    try {
      const items = await db.collection(COL.items).where({ _id: _.in(itemIds) }).get()
      items.data.forEach(it => { itemMap[it._id] = it })
    } catch (e) {}
  }
  const list = reports.data.map(r => {
    const it = itemMap[r.itemId]
    return Object.assign({}, r, {
      targetType: r.targetType || 'item',
      targetNickName: r.targetNickName || '',
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
  const cats = ['books', 'clothes', 'electronics', 'daily', 'other']
  const catCounts = {}
  for (const c of cats) {
    const r = await db.collection(COL.items).where({ status: 'available', category: c }).count()
    catCounts[c] = r.total
  }
  // P2：近 7 天发布趋势（按东八区自然日统计，与签到 dateKey 一致；createTime 为 UTC serverDate）
  const dayLabels = []
  const dayCounts = []
  for (let i = 6; i >= 0; i--) {
    const key = dateKey(-i) // yyyy-mm-dd（东八区）
    const parts = key.split('-')
    const y = +parts[0]
    const m = +parts[1]
    const d = +parts[2]
    // 东八区 0 点 = UTC 前一天 16 点
    const start = new Date(Date.UTC(y, m - 1, d) - 8 * 3600 * 1000)
    const end = new Date(Date.UTC(y, m - 1, d + 1) - 8 * 3600 * 1000)
    dayLabels.push(m + '-' + d)
    const r = await db.collection(COL.items)
      .where(_.and([{ createTime: _.gte(start) }, { createTime: _.lt(end) }]))
      .count()
    dayCounts.push(r.total)
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
  const { userId, targetOpenid, ban } = event
  let res
  if (targetOpenid) {
    const users = await db.collection(COL.users).where({ _openid: targetOpenid }).get()
    if (!users.data.length) return { success: false, message: '用户不存在' }
    res = { data: users.data[0] }
  } else {
    if (!userId) return { success: false, message: '用户ID缺失' }
    res = await db.collection(COL.users).doc(userId).get()
  }
  if (!res.data) return { success: false, message: '用户不存在' }
  if (res.data._openid === openid) return { success: false, message: '不能封禁自己' }
  await db.collection(COL.users).doc(res.data._id).update({ data: { status: ban ? 'banned' : 'normal' } })
  return { success: true, status: ban ? 'banned' : 'normal' }
}

// 意见反馈列表（管理员）：按时间倒序，关联提交人昵称
async function adminFeedbacks(openid) {
  if (!(await isAdminUser(openid))) return { success: false, message: '无管理员权限' }
  const res = await db.collection(COL.feedbacks).orderBy('createTime', 'desc').limit(200).get()
  const openids = [...new Set(res.data.map(f => f._openid).filter(Boolean))]
  const nickMap = {}
  if (openids.length) {
    try {
      const users = await db.collection(COL.users).where({ _openid: _.in(openids) }).field({ nickName: true, avatarUrl: true }).get()
      users.data.forEach(u => { nickMap[u._openid] = { nickName: u.nickName || '匿名', avatarUrl: u.avatarUrl || '' } })
    } catch (e) {}
  }
  const list = res.data.map(f => {
    const u = nickMap[f._openid] || {}
    return {
      _id: f._id,
      content: f.content,
      contact: f.contact || '',
      status: f.status || 'pending',
      createTime: f.createTime,
      nickName: u.nickName || '匿名',
      avatarUrl: u.avatarUrl || ''
    }
  })
  const unread = list.filter(f => f.status === 'pending').length
  return { success: true, list, unread }
}

// 标记反馈状态：pending（未读）/ read（已读）/ done（已处理）
async function handleFeedback(event, openid) {
  if (!(await isAdminUser(openid))) return { success: false, message: '无管理员权限' }
  const { feedbackId, status } = event
  if (!feedbackId) return { success: false, message: '反馈ID缺失' }
  const valid = ['pending', 'read', 'done']
  if (!valid.includes(status)) return { success: false, message: '状态无效' }
  await db.collection(COL.feedbacks).doc(feedbackId).update({ data: { status } })
  return { success: true }
}

// P1：订阅关键词到货提醒
async function subscribeKeyword(event, openid) {
  const { keyword } = event
  const kw = (keyword || '').trim()
  if (!kw || kw.length > 20) return { success: false, message: '关键词无效' }
  const exist = await db.collection(COL.keywordSubs).where({ _openid: openid, keyword: kw }).get()
  if (exist.data.length) return { success: true, already: true }
  await db.collection(COL.keywordSubs).add({
    data: { _openid: openid, keyword: kw, createTime: db.serverDate() }
  })
  return { success: true }
}

async function unsubscribeKeyword(event, openid) {
  const { keyword } = event
  const kw = (keyword || '').trim()
  await db.collection(COL.keywordSubs).where({ _openid: openid, keyword: kw }).remove()
  return { success: true }
}

async function myKeywordSubs(openid) {
  const res = await db.collection(COL.keywordSubs).where({ _openid: openid }).orderBy('createTime', 'desc').get()
  return { success: true, list: res.data.map(r => ({ keyword: r.keyword, createTime: r.createTime })) }
}

// P1：被封禁用户申诉
async function appealBan(event, openid) {
  const { reason } = event
  const text = (reason || '').trim()
  if (!text) return { success: false, message: '请填写申诉理由' }
  if (text.length > 500) return { success: false, message: '申诉理由不能超过500字' }
  // 写入 feedbacks，标记为封禁申诉
  await db.collection(COL.feedbacks).add({
    data: {
      _openid: openid,
      content: '【封禁申诉】' + text,
      contact: '',
      type: 'banAppeal',
      status: 'pending',
      createTime: db.serverDate()
    }
  })
  return { success: true }
}

// 管理员验证：输入正确密钥后，将当前用户标记为管理员
// 密钥从云开发环境变量 ADMIN_SECRET 读取（未配置则不可用，避免密钥出现在公开仓库）
async function becomeAdmin(event, openid) {
  const { secret } = event
  if (!ADMIN_SECRET) return { success: false, message: '管理员密钥未配置，请联系管理员将你的 openid 加入白名单' }
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
  const reports = await db.collection(COL.reports).where({ _openid: openid }).orderBy('createTime', 'desc').limit(100).get()
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

// 我的页面轻量角标（合并原"我的交易"4 个列表请求为 1 次 count，性能改善）
async function myCounts(openid) {
  if (!openid) return { success: true, publishCount: 0, appliedCount: 0, favoriteCount: 0, reportCount: 0 }
  const [p, a, f, r] = await Promise.all([
    db.collection(COL.items).where({ _openid: openid }).count(),
    db.collection(COL.applications).where({ _openid: openid }).count(),
    db.collection(COL.favorites).where({ _openid: openid }).count(),
    db.collection(COL.reports).where({ _openid: openid }).count()
  ])
  return { success: true, publishCount: p.total, appliedCount: a.total, favoriteCount: f.total, reportCount: r.total }
}

// ===================== P7b：积分消费出口（徽章/抽奖/置顶） =====================

// 获取用户积分（内部）
async function getUserPoints(openid) {
  const users = await db.collection(COL.users).where({ _openid: openid }).get()
  if (!users.data.length) return -1
  return users.data[0].points || 0
}

// 徽章目录 + 我的徽章
async function badgeList(openid) {
  const mine = await db.collection(COL.badges).where({ _openid: openid }).get()
  const owned = new Set(mine.data.map(b => b.badgeId))
  return {
    success: true,
    points: await getUserPoints(openid),
    list: BADGES.map(b => Object.assign({}, b, { owned: owned.has(b.id) })),
    myBadges: mine.data.map(b => {
      const meta = BADGES.find(x => x.id === b.badgeId) || {}
      return { id: b._id, badgeId: b.badgeId, name: meta.name || b.badgeId, icon: meta.icon || '🎖️', createTime: b.createTime }
    })
  }
}

// 兑换徽章（扣积分，积分可为负校验）
async function exchangeBadge(event, openid) {
  const { badgeId } = event
  const meta = BADGES.find(b => b.id === badgeId)
  if (!meta) return { success: false, message: '徽章不存在' }
  const exist = await db.collection(COL.badges).where({ _openid: openid, badgeId }).get()
  if (exist.data.length) return { success: false, message: '您已拥有该徽章' }
  const points = await getUserPoints(openid)
  if (points < meta.price) return { success: false, message: '积分不足，还差' + (meta.price - points) + '分' }
  await addPoints(openid, -meta.price, 0, '兑换徽章「' + meta.name + '」', '')
  await db.collection(COL.badges).add({
    data: { _openid: openid, badgeId, createTime: db.serverDate() }
  })
  return { success: true, badge: meta }
}

// 幸运抽奖：10 分一次。中奖概率：+2(30%)/+5(20%)/+10(10%)/称号(5%)/空(35%)
async function lottery(openid) {
  const points = await getUserPoints(openid)
  if (points < 10) return { success: false, message: '积分不足，抽奖需要10分' }
  const r = Math.random()
  let result = { type: 'empty', text: '谢谢参与，下次好运', points: 0, title: '' }
  if (r < 0.30) result = { type: 'points', text: '积分+2', points: 2, title: '' }
  else if (r < 0.50) result = { type: 'points', text: '积分+5', points: 5, title: '' }
  else if (r < 0.60) result = { type: 'points', text: '积分+10', points: 10, title: '' }
  else if (r < 0.65) result = { type: 'title', text: '锦鲤附体称号', points: 0, title: '锦鲤附体' }
  await addPoints(openid, -10 + result.points, 0, '幸运抽奖：' + result.text, '')
  // 称号中奖：写入用户档案，前端展示
  if (result.type === 'title' && result.title) {
    try {
      const users = await db.collection(COL.users).where({ _openid: openid }).get()
      if (users.data.length) {
        await db.collection(COL.users).doc(users.data[0]._id).update({
          data: { title: result.title }
        })
      }
    } catch (e) {}
  }
  try {
    await db.collection(COL.lotteries).add({
      data: { _openid: openid, result: result.text, points: -10 + result.points, title: result.title || '', createTime: db.serverDate() }
    })
  } catch (e) {}
  return { success: true, result, netPoints: -10 + result.points }
}

// 我的抽奖记录
async function myLotteries(openid) {
  const list = await db.collection(COL.lotteries).where({ _openid: openid }).orderBy('createTime', 'desc').limit(20).get()
  return {
    success: true,
    list: list.data.map(l => ({
      id: l._id, result: l.result, points: l.points,
      createTimeStr: formatServerTime(l.createTime)
    }))
  }
}

// 物品置顶 24 小时（20 分；仅发布者本人、仅可领取状态）
async function topItem(event, openid) {
  const { itemId } = event
  if (!itemId) return { success: false, message: '物品ID缺失' }
  const itemRes = await db.collection(COL.items).doc(itemId).get()
  const item = itemRes.data
  if (!item) return { success: false, message: '物品不存在' }
  if (item._openid !== openid) return { success: false, message: '仅发布者本人可置顶' }
  if (item.status !== 'available') return { success: false, message: '仅可领取状态的物品可置顶' }
  const points = await getUserPoints(openid)
  if (points < 20) return { success: false, message: '积分不足，置顶需要20分' }
  await addPoints(openid, -20, 0, '物品置顶24小时', item.title)
  await db.collection(COL.items).doc(itemId).update({
    data: { topUntil: new Date(Date.now() + 24 * 3600 * 1000) }
  })
  return { success: true, topUntil: formatServerTime(new Date(Date.now() + 24 * 3600 * 1000)) }
}

// ===================== P6：心愿求购 =====================

// 发布求购需求（公益需求侧发帖）
async function publishWish(event, openid) {
  if (await isBannedUser(openid)) return { success: false, message: '账号已被封禁，无法发布求购' }
  const { title, description, category } = event
  if (!title || !title.trim()) return { success: false, message: '请输入求购标题' }
  if (title.trim().length > 30) return { success: false, message: '标题不能超过30个字' }
  if (!description || !description.trim()) return { success: false, message: '请输入求购说明' }
  if (description.trim().length > 500) return { success: false, message: '说明不能超过500字' }
  const textCheck = await checkText(title + ' ' + description, openid)
  if (!textCheck.passed) return { success: false, code: 'CONTENT_RISK', message: textCheck.message }
  const users = await db.collection(COL.users).where({ _openid: openid }).get()
  const u = users.data[0]
  await db.collection(COL.wishes).add({
    data: {
      _openid: openid,
      title: title.trim(),
      description: description.trim(),
      category: category || 'other',
      status: 'open',
      nickName: (u && u.nickName) || '同学',
      avatarUrl: (u && u.avatarUrl) || '',
      createTime: db.serverDate()
    }
  })
  return { success: true }
}

// 求购列表（仅 open 状态，分页+分类；脱敏不返回发布者 openid）
async function wishList(event) {
  const { category = 'all', page = 1, pageSize = 10 } = event
  let q = db.collection(COL.wishes).where({ status: 'open' })
  if (category !== 'all') q = q.where({ category })
  const countRes = await q.count()
  const listRes = await q.orderBy('createTime', 'desc').skip((page - 1) * pageSize).limit(pageSize).get()
  return {
    success: true,
    list: listRes.data.map(w => {
      const { _openid, ...rest } = w
      return rest
    }),
    total: countRes.total,
    hasMore: page * pageSize < countRes.total
  }
}

// 求购详情（脱敏，返回是否本人发布）
async function wishDetail(event, openid) {
  const { id } = event
  if (!id) return { success: false, message: '求购ID缺失' }
  const res = await db.collection(COL.wishes).doc(id).get()
  if (!res.data) return { success: false, message: '求购不存在' }
  const w = res.data
  return {
    success: true,
    wish: {
      id: w._id,
      title: w.title,
      description: w.description,
      category: w.category,
      status: w.status,
      nickName: w.nickName || '同学',
      avatarUrl: w.avatarUrl || '',
      createTimeStr: formatServerTime(w.createTime),
      isMine: w._openid === openid
    }
  }
}

// 我发布的求购（含已结束，供关闭管理）
async function myWishes(openid) {
  const list = await db.collection(COL.wishes).where({ _openid: openid }).orderBy('createTime', 'desc').limit(50).get()
  return { success: true, list: list.data.map(w => Object.assign({}, w, { id: w._id })) }
}

// 求购者关闭求购（标记 fulfilled）
async function closeWish(event, openid) {
  const { id } = event
  if (!id) return { success: false, message: '求购ID缺失' }
  const res = await db.collection(COL.wishes).doc(id).get()
  if (!res.data) return { success: false, message: '求购不存在' }
  if (res.data._openid !== openid) return { success: false, message: '无权操作该求购' }
  await db.collection(COL.wishes).doc(id).update({ data: { status: 'fulfilled' } })
  return { success: true }
}

// 我有闲置，联系求购者（创建/复用站内会话 + 首条留言 + 订阅通知）
async function offerWish(event, openid) {
  if (await isBannedUser(openid)) return { success: false, message: '账号已被封禁，无法联系求购者' }
  const { wishId, message } = event
  if (!wishId) return { success: false, message: '求购ID缺失' }
  const msg = (message || '').trim()
  if (!msg) return { success: false, message: '请填写留言' }
  if (msg.length > 500) return { success: false, message: '留言过长' }
  const textCheck = await checkText(msg, openid)
  if (!textCheck.passed) return { success: false, code: 'CONTENT_RISK', message: textCheck.message }
  const wishRes = await db.collection(COL.wishes).doc(wishId).get()
  const wish = wishRes.data
  if (!wish) return { success: false, message: '求购不存在' }
  if (wish._openid === openid) return { success: false, message: '不能联系自己的求购' }
  if (wish.status !== 'open') return { success: false, message: '该求购已结束' }

  const users = await db.collection(COL.users).where({ _openid: openid }).get()
  const u = users.data[0]
  const nickName = (u && u.nickName) || '同学'
  const avatarUrl = (u && u.avatarUrl) || ''
  try {
    const conv = await getOrCreateConversation(openid, {
      wishId,
      title: wish.title,
      image: '',
      status: wish.status,
      ownerOpenid: wish._openid,
      ownerNickName: wish.nickName,
      ownerAvatarUrl: wish.avatarUrl
    }, nickName, avatarUrl)
    // 首条消息
    await db.collection(COL.messages).add({
      data: {
        _openid: openid,
        convId: conv._id,
        fromOpenid: openid,
        toOpenid: wish._openid,
        content: '【我想帮忙】' + msg,
        read: false,
        createTime: db.serverDate()
      }
    })
    await db.collection(COL.conversations).doc(conv._id).update({
      data: { lastMessage: '【我想帮忙】' + msg, lastTime: db.serverDate() }
    })
    // 订阅通知求购者
    await notifyApplyNotice(openid, wish._openid, nickName, msg)
    return { success: true, convId: conv._id }
  } catch (e) {
    console.warn('创建求购会话失败:', e)
    return { success: true }
  }
}

// ===================== 入口 =====================
exports.main = async (event, context) => {
  const { action } = event
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  // 定时触发器：每天凌晨3点自动处理超时未确认的赠送（3天未确认→物品重新上架）
  if (!action || action === 'timer' || event.Type === 'timer') {
    await ensureCollections()
    await expireOverdueConfirmations()
    return { success: true, timer: 'expireOverdueConfirmations done' }
  }

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
      case 'confirmReceive': return await confirmReceive(event, openid)
      case 'badgeList': return await badgeList(openid)
      case 'exchangeBadge': return await exchangeBadge(event, openid)
      case 'lottery': return await lottery(openid)
      case 'myLotteries': return await myLotteries(openid)
      case 'topItem': return await topItem(event, openid)
      case 'blockUser': return await blockUser(event, openid)
      case 'unblockUser': return await unblockUser(event, openid)
      case 'myBlacklist': return await myBlacklist(openid)
      case 'blockStatus': return await blockStatus(event, openid)
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
      case 'checkinMonth': return await checkinMonth(event, openid)
      case 'submitFeedback': return await submitFeedback(event, openid)
      case 'updateProfile': return await updateProfile(event, openid)
      case 'userProfile': return await userProfile(event, openid)
      case 'myCounts': return await myCounts(openid)
      case 'myCertificates': return await myCertificates(openid)
      case 'submitEvaluation': return await submitEvaluation(event, openid)
      case 'evaluationStatus': return await evaluationStatus(event, openid)
      case 'publishWish': return await publishWish(event, openid)
      case 'wishList': return await wishList(event)
      case 'wishDetail': return await wishDetail(event, openid)
      case 'myWishes': return await myWishes(openid)
      case 'closeWish': return await closeWish(event, openid)
      case 'offerWish': return await offerWish(event, openid)
      case 'adminStats': return await adminStats(openid)
      case 'adminItems': return await adminItems(event, openid)
      case 'adminSetItemStatus': return await adminSetItemStatus(event, openid)
      case 'adminDeleteItem': return await adminDeleteItem(event, openid)
      case 'adminUsers': return await adminUsers(event, openid)
      case 'adminBanUser': return await adminBanUser(event, openid)
      case 'adminFeedbacks': return await adminFeedbacks(openid)
      case 'handleFeedback': return await handleFeedback(event, openid)
      case 'subscribeKeyword': return await subscribeKeyword(event, openid)
      case 'unsubscribeKeyword': return await unsubscribeKeyword(event, openid)
      case 'myKeywordSubs': return await myKeywordSubs(openid)
      case 'appealBan': return await appealBan(event, openid)
      default: return { success: false, message: '未知操作: ' + action }
    }
  } catch (e) {
    console.error('campusApi error:', e)
    return { success: false, message: '服务器异常: ' + (e.message || e.errMsg || '未知错误') }
  }
}
