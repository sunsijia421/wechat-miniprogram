const app = getApp()
const util = require('../../utils/util')

Page({
  data: {
    userInfo: null,
    activeTab: 'published', // published | applied | reported

    // 我发布的
    publishedItems: [],

    // 我申请的
    appliedItems: [],

    // 我举报的（受理结果）
    myReports: [],

    // 管理员（登录后自动识别，无需密钥）
    isAdmin: false
  },

  onShow() {
    this.loadUserInfo()
    this.loadPublishedItems()
    this.loadAppliedItems()
    this.loadMyReports()
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

  // 加载我提交的举报（受理结果）
  loadMyReports() {
    if (!app.getOpenid()) return
    util.callApi('myReports', {})
      .then(res => {
        const list = res.list.map(r => ({
          id: r._id,
          itemId: r.itemId,
          itemTitle: r.itemTitle || '(物品已删除)',
          reason: r.reason,
          createTimeStr: util.formatTime(r.createTime),
          statusText: r.status === 'handled'
            ? (r.result === 'offline' ? '已下架' : '已忽略')
            : '待处理'
        }))
        this.setData({ myReports: list })
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
            publishedItems: [],
            appliedItems: [],
            myReports: []
          })
          wx.showToast({ title: '本地数据已清除', icon: 'success' })
        }
      }
    })
  }
})
