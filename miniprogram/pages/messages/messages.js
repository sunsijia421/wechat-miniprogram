const util = require('../../utils/util')

Page({
  data: {
    conversations: [],
    loading: false,
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
        this.updateTabBadge()
      })
      .catch(e => {
        this.setData({ loading: false })
        wx.showToast({ title: typeof e === 'string' ? e : '加载失败', icon: 'none' })
      })
      .then(() => {
        wx.stopPullDownRefresh()
      })
  },

  // 更新消息 Tab 角标（未读数）
  updateTabBadge() {
    const total = this.data.conversations.reduce((s, c) => s + (c.unreadCount || 0), 0)
    if (total > 0) {
      wx.setTabBarBadge({
        index: 2, // 消息是第 3 个 Tab（首页/发布/消息/我的）
        text: total > 99 ? '99+' : String(total)
      })
    } else {
      wx.removeTabBarBadge({ index: 2 })
    }
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
