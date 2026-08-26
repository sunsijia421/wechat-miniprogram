const app = getApp()
const util = require('../../utils/util')

Page({
  data: {
    userInfo: null,
    activeTab: 'published', // published | applied

    // 我发布的
    publishedItems: [],

    // 我申请的
    appliedItems: []
  },

  onShow() {
    this.loadUserInfo()
    this.loadPublishedItems()
    this.loadAppliedItems()
  },

  // 统一处理云端返回的物品字段
  normalizeItem(item) {
    return Object.assign({}, item, {
      id: item._id,
      categoryName: util.getCategoryName(item.category),
      createTimeStr: util.formatTime(new Date(item.createTime).getTime()),
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
