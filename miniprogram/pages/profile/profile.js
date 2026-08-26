const app = getApp()
const util = require('../../utils/util')

Page({
  data: {
    userInfo: null,
    activeTab: 'published', // published | applied

    // 我发布的
    publishedItems: [],

    // 我申请的
    appliedItems: [],

    // 管理员
    isAdmin: false,
    showAdminVerify: false,
    adminSecret: ''
  },

  onShow() {
    this.loadUserInfo()
    this.loadPublishedItems()
    this.loadAppliedItems()
    this.checkAdmin()
  },

  // 统一处理云端返回的物品字段
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
      this.setData({ userInfo })
    }
  },

  // 切换 Tab
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ activeTab: tab })
  },

  // 加载我发布的物品（云端）
  loadPublishedItems() {
    if (!app.getOpenid()) return
    util.callApi('myPublish', {})
      .then(res => {
        const list = res.list.map(it => this.normalizeItem(it))
        this.setData({ publishedItems: list })
      })
      .catch(() => {})
  },

  // 加载我申请的物品（云端）
  loadAppliedItems() {
    if (!app.getOpenid()) return
    util.callApi('myApply', {})
      .then(res => {
        const list = res.list.map(it => this.normalizeItem(it))
        this.setData({ appliedItems: list })
      })
      .catch(() => {})
  },

  // 点击物品跳转详情
  onItemTap(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/detail/detail?id=${id}`
    })
  },

  // 检查管理员身份
  checkAdmin() {
    if (!app.getUserInfo()) return
    util.callApi('isAdmin')
      .then(res => this.setData({ isAdmin: res.isAdmin }))
      .catch(() => {})
  },

  // 进入举报管理
  goAdmin() {
    wx.navigateTo({ url: '/pages/admin/admin' })
  },

  // 管理员验证弹窗
  openAdminVerify() {
    this.setData({ showAdminVerify: true, adminSecret: '' })
  },

  closeAdminVerify() {
    this.setData({ showAdminVerify: false, adminSecret: '' })
  },

  onAdminSecretInput(e) {
    this.setData({ adminSecret: e.detail.value })
  },

  submitAdminVerify() {
    const secret = (this.data.adminSecret || '').trim()
    if (!secret) {
      wx.showToast({ title: '请输入管理密钥', icon: 'none' })
      return
    }
    util.callApi('becomeAdmin', { secret: secret })
      .then(() => {
        this.setData({ showAdminVerify: false, adminSecret: '', isAdmin: true })
        wx.showToast({ title: '验证成功，已成为管理员', icon: 'success' })
      })
      .catch(e => {
        wx.showToast({ title: typeof e === 'string' ? e : '验证失败', icon: 'none' })
      })
  },

  // 阻止弹窗冒泡
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
          app.globalData.userInfo = null
          app.globalData.isAgreed = false
          app.globalData.openid = ''
          this.setData({ userInfo: null })
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
          this.setData({
            userInfo: null,
            publishedItems: [],
            appliedItems: []
          })
          wx.showToast({ title: '本地数据已清除', icon: 'success' })
        }
      }
    })
  }
})
