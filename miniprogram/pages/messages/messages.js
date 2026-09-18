const util = require('../../utils/util')

Page({
  data: {
    conversations: [],
    loading: true,
    isEmpty: false
  },

  onShow() {
    if (!util.requireLogin()) return
    this.loadConversations()
  },

  onPullDownRefresh() {
    this.loadConversations(true)
  },

  loadConversations(isRefresh) {
    if (this.data.loading && !isRefresh) return
    this.setData({ loading: true })
    util.callApi('myConversations', {})
      .then(res => {
        const list = res.list.map(c => Object.assign({}, c, {
          lastTimeText: util.formatTime(c.lastTime)
        }))
        this.setData({
          conversations: list,
          loading: false,
          isEmpty: list.length === 0
        })
      })
      .catch(e => {
        this.setData({ loading: false })
        wx.showToast({ title: typeof e === 'string' ? e : '加载失败', icon: 'none' })
      })
      .then(() => {
        wx.stopPullDownRefresh()
      })
  },

  // 进入会话
  openChat(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/chat/chat?convId=' + id })
  },

  // 进入物品详情
  goItem(e) {
    const id = e.currentTarget.dataset.itemid
    if (!id) return
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
  },

  goHome() {
    wx.switchTab({ url: '/pages/index/index' })
  }
})
