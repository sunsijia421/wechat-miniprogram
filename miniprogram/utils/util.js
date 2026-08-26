/**
 * 工具函数库
 */

/**
 * 生成唯一 ID
 * 格式：时间戳_随机字符串
 */
function generateId() {
  return Date.now() + '_' + Math.random().toString(36).substr(2, 6)
}

/**
 * 格式化时间
 * @param {number} timestamp - 时间戳（毫秒）
 * @returns {string} 格式化后的时间字符串
 */
function formatTime(timestamp) {
  // 兼容云数据库 serverDate 回传前端的 { $date: 毫秒数 } 结构，否则会变成 Invalid Date
  if (timestamp && typeof timestamp === 'object' && timestamp.$date) {
    timestamp = timestamp.$date
  }
  var now = new Date()
  var date = new Date(timestamp)
  var diff = now - date

  if (diff < 60000) {
    return '刚刚'
  } else if (diff < 3600000) {
    return Math.floor(diff / 60000) + '分钟前'
  } else if (diff < 86400000) {
    return Math.floor(diff / 3600000) + '小时前'
  } else if (diff < 604800000) {
    return Math.floor(diff / 86400000) + '天前'
  }

  var year = date.getFullYear()
  var month = (date.getMonth() + 1).toString()
  var day = date.getDate().toString()
  var hour = date.getHours().toString()
  var minute = date.getMinutes().toString()

  if (month.length === 1) month = '0' + month
  if (day.length === 1) day = '0' + day
  if (hour.length === 1) hour = '0' + hour
  if (minute.length === 1) minute = '0' + minute

  if (year === now.getFullYear()) {
    return month + '-' + day + ' ' + hour + ':' + minute
  }
  return year + '-' + month + '-' + day + ' ' + hour + ':' + minute
}

/**
 * 格式化完整时间（用于 completeTime）
 */
function formatFullTime(timestamp) {
  var date = new Date(timestamp)
  var year = date.getFullYear()
  var month = (date.getMonth() + 1).toString()
  var day = date.getDate().toString()
  var hour = date.getHours().toString()
  var minute = date.getMinutes().toString()
  var second = date.getSeconds().toString()

  if (month.length === 1) month = '0' + month
  if (day.length === 1) day = '0' + day
  if (hour.length === 1) hour = '0' + hour
  if (minute.length === 1) minute = '0' + minute
  if (second.length === 1) second = '0' + second

  return year + '-' + month + '-' + day + ' ' + hour + ':' + minute + ':' + second
}

/**
 * 分类映射
 */
var CATEGORIES = {
  'books': '📚 书籍',
  'clothes': '👔 衣物',
  'electronics': '💻 电子产品',
  'other': '📦 其他'
}

var CATEGORY_LIST = ['全部', '书籍', '衣物', '电子产品', '其他']
var CATEGORY_KEYS = ['all', 'books', 'clothes', 'electronics', 'other']

/**
 * 获取分类显示名称
 */
function getCategoryName(key) {
  return CATEGORIES[key] || '未分类'
}

/**
 * 深拷贝
 */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj))
}

// ==================== 内容安全审核（本地兜底） ====================

/**
 * 敏感词库（仅作前端快速预校验，权威审核在云函数 msgSecCheck）
 * 仅保留明确的违规/金钱交易强相关词，避免误杀正常描述（如"原价30元赠送"）
 */
var SENSITIVE_WORDS = [
  '广告', '推广', '加微信', '加QQ', '微信号', 'QQ号',
  '赌博', '色情', '暴力', '枪支', '毒品',
  '代考', '代写', '作弊',
  '贷款', '套现', '信用卡',
  '传销', '直销', '代理',
  '兼职', '日结', '刷单'
]

/**
 * 文本内容安全检查
 * @param {string} text - 待检查文本
 * @returns {object} { passed: boolean, word: string|null }
 */
function checkTextContent(text) {
  if (!text || typeof text !== 'string') {
    return { passed: true, word: null }
  }
  // 仅拦截明确的金钱交易强相关词，中性词（元/块/¥等）不拦截，避免误杀
  var moneyWords = ['出售', '购买', '付款', '转账', '红包', '收款', '多少钱', '收费', '现金交易', '一口价']
  for (var i = 0; i < moneyWords.length; i++) {
    if (text.indexOf(moneyWords[i]) !== -1) {
      return { passed: false, word: moneyWords[i] }
    }
  }
  // 敏感词过滤
  for (var j = 0; j < SENSITIVE_WORDS.length; j++) {
    if (text.indexOf(SENSITIVE_WORDS[j]) !== -1) {
      return { passed: false, word: SENSITIVE_WORDS[j] }
    }
  }
  return { passed: true, word: null }
}

/**
 * 图片内容安全审核（模拟）
 * 注意：由于不使用云服务，无法调用微信图片安全审核API（security.imgSecCheck）
 * 真实项目中应使用云函数调用 wx.cloud.callFunction 或服务端API
 * 此处仅做格式校验和大小估算（通过 tempFilePath 判断格式）
 */
function checkImageContent(filePaths) {
  if (!filePaths || filePaths.length === 0) {
    return { passed: true, message: '' }
  }
  // 检查文件扩展名（仅允许常见图片格式）
  for (var i = 0; i < filePaths.length; i++) {
    var path = filePaths[i].toLowerCase()
    if (path.indexOf('.gif') !== -1) {
      return { passed: false, message: '不支持GIF格式图片' }
    }
    if (path.indexOf('.bmp') !== -1) {
      return { passed: false, message: '不支持BMP格式图片' }
    }
  }
  return { passed: true, message: '' }
}

// ==================== 云函数调用封装 ====================
// 统一调用 campusApi 云函数：成功 resolve(result)，失败 reject(message)
function callApi(action, data) {
  return new Promise(function (resolve, reject) {
    if (!wx.cloud) {
      reject('云开发未初始化')
      return
    }
    wx.cloud.callFunction({
      name: 'campusApi',
      data: Object.assign({ action: action }, data || {}),
      success: function (res) {
        const result = res.result || {}
        if (result.success) resolve(result)
        else reject(result.message || '操作失败')
      },
      fail: function (err) {
        reject((err && err.errMsg) || '网络请求失败')
      }
    })
  })
}

module.exports = {
  generateId: generateId,
  formatTime: formatTime,
  formatFullTime: formatFullTime,
  getCategoryName: getCategoryName,
  CATEGORY_LIST: CATEGORY_LIST,
  CATEGORY_KEYS: CATEGORY_KEYS,
  deepClone: deepClone,
  checkTextContent: checkTextContent,
  checkImageContent: checkImageContent,
  SENSITIVE_WORDS: SENSITIVE_WORDS,
  callApi: callApi
}
