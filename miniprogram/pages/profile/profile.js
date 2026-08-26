const app = getApp()

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

  // 加载我发布的物品
  loadPublishedItems() {
    const userInfo = app.getUserInfo()
    if (!userInfo) return

    const items = wx.getStorageSync('items') || []
    const publishedItems = items
      .filter(item => item.publisherNickName === userInfo.nickName)
      .sort((a, b) => b.createTime - a.createTime)

    this.setData({ publishedItems })
  },

  // 加载我申请的物品
  loadAppliedItems() {
    const userInfo = app.getUserInfo()
    if (!userInfo) return

    const applications = wx.getStorageSync('applications') || []
    const items = wx.getStorageSync('items') || []

    // 获取当前用户申请过的 itemId
    const appliedItemIds = applications
      .filter(a => a.applicantName === userInfo.nickName)
      .map(a => a.itemId)

    // 去重
    const uniqueItemIds = [...new Set(appliedItemIds)]

    // 根据 itemId 获取物品信息
    const appliedItems = uniqueItemIds
      .map(id => items.find(item => item.id === id))
      .filter(Boolean)
      .sort((a, b) => b.createTime - a.createTime)

    this.setData({ appliedItems })
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
          app.globalData.userInfo = null
          app.globalData.isAgreed = false
          this.setData({ userInfo: null })
          wx.showToast({ title: '已退出', icon: 'success' })
          setTimeout(() => {
            wx.switchTab({ url: '/pages/index/index' })
          }, 1000)
        }
      }
    })
  },

  // 清除所有数据（调试用）
  clearAllData() {
    wx.showModal({
      title: '清除所有数据',
      content: '此操作将清除所有本地数据（包括物品、申请、举报等），不可恢复！',
      confirmText: '确认清除',
      cancelText: '取消',
      confirmColor: '#f44336',
      success: (res) => {
        if (res.confirm) {
          wx.clearStorageSync()
          app.globalData.userInfo = null
          app.globalData.isAgreed = false
          this.setData({
            userInfo: null,
            publishedItems: [],
            appliedItems: []
          })
          wx.showToast({ title: '数据已清除', icon: 'success' })
        }
      }
    })
  }
})
