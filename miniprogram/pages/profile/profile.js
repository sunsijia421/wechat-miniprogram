const app = getApp()
const util = require('../../utils/util')

Page({
  data: {
    userInfo: null,
    openid: '',
    shortOpenid: '',

    // 我的交易角标（轻量 count，替代原 4 个列表请求，性能改善）
    publishCount: 0,
    appliedCount: 0,
    favoriteCount: 0,
    reportCount: 0,

    // 管理员（登录后自动识别，无需密钥）
    isAdmin: false,

    // P1：积分等级
    level: { name: '初心者', icon: '🌱', progress: 0, isMax: false, nextMin: 20 },
    levelNextName: '公益使者'
  },

  onShow() {
    this.loadUserInfo()
    this.loadCounts()
    this.checkAdmin()
    util.refreshMessageBadge()
  },

  // 统一处理云端返回的物品字段（保留兼容）
  normalizeItem(item) {
    return Object.assign({}, item, {
      id: item._id,
      categoryName: util.getCategoryName(item.category),
      createTimeStr: util.formatTime(item.createTime),
      images: item.images || []
    })
  },

  // 加载用户信息
  loadUserInfo() {
    const userInfo = app.getUserInfo()
    if (userInfo) {
      const level = util.getLevel(userInfo.points)
      // 下一等级名称（用于"距XX还差N分"）
      const levelNames = { 初心者: '公益使者', 公益使者: '公益达人', 公益达人: '公益先锋', 公益先锋: '公益大使', 公益大使: '' }
      this.setData({
        userInfo,
        openid: app.getOpenid() || '',
        shortOpenid: util.maskOpenid(app.getOpenid() || ''),
        level,
        levelNextName: levelNames[level.name] || ''
      })
    }
  },

  // 加载我的交易角标（一次 count 接口替代 4 个列表请求）
  loadCounts() {
    if (!app.getOpenid()) return
    util.callApi('myCounts', {})
      .then(res => {
        this.setData({
          publishCount: res.publishCount || 0,
          appliedCount: res.appliedCount || 0,
          favoriteCount: res.favoriteCount || 0,
          reportCount: res.reportCount || 0
        })
      })
      .catch(() => {})
  },

  // 跳转个人主页
  goUserHome() {
    wx.navigateTo({ url: '/pages/userHome/userHome' })
  },

  // 跳转设置页
  goSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' })
  },

  // P1：跳转积分明细
  goPointLogs() {
    wx.navigateTo({ url: '/pages/pointLogs/pointLogs' })
  },

  // P1：跳转公益排行榜
  goRank() {
    wx.navigateTo({ url: '/pages/rank/rank' })
  },

  // P4：跳转我的公益证书
  goCertificates() {
    wx.navigateTo({ url: '/pages/certificates/certificates' })
  },

  // 跳转"我的交易"独立列表页（published/applied/favorites/reported）
  goMyList(e) {
    const type = e.currentTarget.dataset.type
    wx.navigateTo({ url: '/pages/myList/myList?type=' + type })
  },

  // 跳转意见反馈
  goFeedback() {
    wx.navigateTo({ url: '/pages/feedback/feedback' })
  },

  // 检查管理员身份（登录后自动识别，结果同步到全局）
  checkAdmin() {
    if (!app.getUserInfo()) return
    util.callApi('isAdmin')
      .then(res => {
        app.setIsAdmin(res.isAdmin)
        this.setData({ isAdmin: res.isAdmin })
      })
      .catch(() => {})
  },

  // 进入举报管理
  goAdmin() {
    wx.navigateTo({ url: '/pages/admin/admin' })
  },

  // 阻止弹窗冒泡（保留兼容）
  stopPropagation() {},

  // 退出登录
  logout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后需要重新授权才能使用',
      confirmText: '退出',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          wx.removeStorageSync('userInfo')
          wx.removeStorageSync('isAgreed')
          wx.removeStorageSync('openid')
          wx.removeStorageSync('isAdmin')
          app.globalData.userInfo = null
          app.globalData.isAgreed = false
          app.globalData.openid = ''
          app.globalData.isAdmin = false
          this.setData({ userInfo: null, isAdmin: false })
          wx.showToast({ title: '已退出', icon: 'success' })
          setTimeout(() => {
            wx.switchTab({ url: '/pages/index/index' })
          }, 1000)
        }
      }
    })
  },

  // 清除本机缓存（仅本地登录信息，云端数据不受影响）
  clearAllData() {
    wx.showModal({
      title: '清除本地数据',
      content: '此操作仅清除本机登录与缓存信息（云端数据不受影响），确定继续吗？',
      confirmText: '确认清除',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          wx.clearStorageSync()
          app.globalData.userInfo = null
          app.globalData.isAgreed = false
          app.globalData.openid = ''
          app.globalData.isAdmin = false
          this.setData({
            userInfo: null,
            isAdmin: false,
            publishCount: 0,
            appliedCount: 0,
            favoriteCount: 0,
            reportCount: 0
          })
          wx.showToast({ title: '本地数据已清除', icon: 'success' })
        }
      }
    })
  }
})
