const app = getApp()
const util = require('../../utils/util')

Page({
  data: {
    user: null,
    followCount: 0,
    fanCount: 0,
    items: [],
    evaluations: [],
    activeTab: 'items', // items | comments
    loading: false,
    isMe: true,
    myBadges: []
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
        // P5：评价列表（预计算星串，wxml 不支持方法调用）
        const evaluations = (res.evaluations || []).map(ev => Object.assign({}, ev, {
          ratingStars: '★★★★★'.slice(0, ev.rating || 5),
          ratingGray: '★★★★★'.slice(0, 5 - (ev.rating || 5))
        }))
        const user = res.user || {}
        const avg = Number(user.avgRating) || 0
        const fullStars = Math.round(avg)
        user.avgStars = '★★★★★'.slice(0, fullStars)
        user.avgStarsGray = '★★★★★'.slice(0, 5 - fullStars)
        this.setData({
          user,
          followCount: res.followCount || 0,
          fanCount: res.fanCount || 0,
          items,
          evaluations,
          loading: false
        })
        // P7：加载已拥有徽章（徽章墙）
        this.loadMyBadges()
      })
      .catch(e => {
        this.setData({ loading: false })
        wx.showToast({ title: typeof e === 'string' ? e : '加载失败', icon: 'none' })
      })
      .then(() => wx.stopPullDownRefresh())
  },

  // P7：徽章墙（已拥有徽章）
  loadMyBadges() {
    util.callApi('badgeList', {})
      .then(res => {
        const myIds = (res.myBadges || []).map(b => b.badgeId)
        const owned = (res.list || []).filter(b => myIds.indexOf(b.id) >= 0)
        this.setData({ myBadges: owned })
      })
      .catch(() => {})
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
