/**
 * 生成唯一 ID
 * 格式：时间戳 + 随机数
 */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 10)
}

/**
 * 格式化时间
 * @param {number} timestamp - 时间戳（毫秒）
 * @returns {string} 格式化后的时间字符串
 */
function formatTime(timestamp) {
  const now = new Date()
  const date = new Date(timestamp)
  const diff = now - date

  if (diff < 60000) {
    return '刚刚'
  } else if (diff < 3600000) {
    return Math.floor(diff / 60000) + '分钟前'
  } else if (diff < 86400000) {
    return Math.floor(diff / 3600000) + '小时前'
  } else if (diff < 604800000) {
    return Math.floor(diff / 86400000) + '天前'
  }

  const year = date.getFullYear()
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  const hour = date.getHours().toString().padStart(2, '0')
  const minute = date.getMinutes().toString().padStart(2, '0')

  if (year === now.getFullYear()) {
    return `${month}-${day} ${hour}:${minute}`
  }
  return `${year}-${month}-${day} ${hour}:${minute}`
}

/**
 * 分类映射
 */
const CATEGORIES = {
  'books': '📚 书籍',
  'clothes': '👔 衣物',
  'electronics': '💻 电子产品',
  'other': '📦 其他'
}

const CATEGORY_LIST = ['全部', '书籍', '衣物', '电子产品', '其他']
const CATEGORY_KEYS = ['all', 'books', 'clothes', 'electronics', 'other']

/**
 * 获取分类显示名称
 */
function getCategoryName(key) {
  return CATEGORIES[key] || '其他'
}

/**
 * 深拷贝
 */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj))
}

module.exports = {
  generateId,
  formatTime,
  getCategoryName,
  CATEGORY_LIST,
  CATEGORY_KEYS,
  deepClone
}
