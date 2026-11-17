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
    // 一次性激活：非管理员时显示「激活管理员」，输入密钥后永久生效
    showAdminActivate: false,
    adminSecret: '',

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
      const levelNames = { 初心者: '公益使者', 公益使者: '公益达人', 公益达人: '公益先锋', 公益先锋: '公益大使', 公益大使: '' }
      this.setData({
        userInfo,
        openid: app.getOpenid() || '',
        shortOpenid: util.maskOpenid(app.getOpenid() || ''),
        level,
        levelNextName: levelNames[level.name] || ''
      })
    }
    // 以云端为准刷新积分/捐赠次数
    util.callApi('userProfile', { openid: app.getOpenid() || '' }).then(res => {
      if (res.success !== false && res.points !== undefined) {
        const updated = Object.assign({}, app.getUserInfo() || {}, {
          points: res.points || 0,
          donateCount: res.donateCount || 0,
          nickName: res.nickName,
          avatarUrl: res.avatarUrl,
          bio: res.bio || '',
          region: res.region || ''
        })
        app.saveUserInfo(updated)
        this.setData({
          userInfo: updated,
          level: util.getLevel(updated.points)
        })
      }
    }).catch(() => {})
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

  // P7：跳转积分商城（徽章兑换/抽奖）
  goShop() {
    wx.navigateTo({ url: '/pages/shop/shop' })
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

  // P2：分享小程序邀请好友
  onShareAppMessage() {
    const openid = app.getOpenid() || ''
    return {
      title: '🌱 佳禾换物小站——乡村闲置物资免费流转，一起做公益',
      path: '/pages/index/index?inviteBy=' + openid,
      imageUrl: ''
    }
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

  // 激活管理员（一次性操作：成功后云端永久标记，之后登录自动进管理后台）
  openAdminActivate() {
    this.setData({ showAdminActivate: true, adminSecret: '' })
  },

  closeAdminActivate() {
    this.setData({ showAdminActivate: false, adminSecret: '' })
  },

  onAdminSecretInput(e) {
    this.setData({ adminSecret: e.detail.value })
  },

  submitAdminActivate() {
    const secret = (this.data.adminSecret || '').trim()
    if (!secret) {
      wx.showToast({ title: '请输入管理密钥', icon: 'none' })
      return
    }
    wx.showLoading({ title: '验证中', mask: true })
    util.callApi('becomeAdmin', { secret })
      .then(() => {
        wx.hideLoading()
        app.setIsAdmin(true)
        this.setData({ showAdminActivate: false, adminSecret: '', isAdmin: true })
        wx.showModal({
          title: '激活成功',
          content: '你已成为管理员，之后登录会自动进入管理后台。',
          showCancel: false,
          confirmText: '立即进入',
          success: (r) => {
            if (r.confirm) wx.navigateTo({ url: '/pages/admin/admin' })
          }
        })
      })
      .catch(e => {
        wx.hideLoading()
        wx.showToast({ title: typeof e === 'string' ? e : '密钥不正确', icon: 'none' })
      })
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
