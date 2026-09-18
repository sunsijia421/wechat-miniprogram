const app = getApp()
const util = require('../../utils/util')

Page({
  data: {
    user: null,
    followCount: 0,
    fanCount: 0,
    items: [],
    activeTab: 'items', // items | comments
    loading: false,
    isMe: true
  },

  onLoad(options) {
    this.setData({ isMe: !options.openid })
  },

  onShow() {
    this.loadProfile()
  },

  onPullDownRefresh() {
    this.loadProfile(true)
  },

  loadProfile(isRefresh) {
    if (this.data.loading && !isRefresh) return
    if (!util.requireLogin()) return
    this.setData({ loading: true })
    util.callApi('userProfile', {})
      .then(res => {
        const items = (res.items || []).map(it => Object.assign({}, it, {
          categoryName: util.getCategoryName(it.category),
          statusText: it.status === 'completed' ? '已送出' : it.status === 'offline' ? '已下架' : '可领取',
          statusClass: it.status === 'completed' ? 'completed' : it.status === 'offline' ? 'offline' : 'available'
        }))
        this.setData({
          user: res.user,
          followCount: res.followCount || 0,
          fanCount: res.fanCount || 0,
          items,
          loading: false
        })
      })
      .catch(e => {
        this.setData({ loading: false })
        wx.showToast({ title: typeof e === 'string' ? e : '加载失败', icon: 'none' })
      })
      .then(() => wx.stopPullDownRefresh())
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ activeTab: tab })
  },

  onItemTap(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
  },

  goSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' })
  }
})
