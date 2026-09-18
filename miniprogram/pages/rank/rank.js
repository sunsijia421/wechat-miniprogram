const util = require('../../utils/util')

Page({
  data: {
    byPoints: [],
    byDonate: [],
    loading: false,
    activeTab: 'points' // points | donate
  },

  onShow() {
    this.loadRank()
  },

  onPullDownRefresh() {
    this.loadRank(true)
  },

  loadRank(isRefresh) {
    if (this.data.loading && !isRefresh) return
    this.setData({ loading: true })
    util.callApi('rankList', {})
      .then(res => {
        const self = this
        const medal = ['🥇', '🥈', '🥉']
        const decorate = (list) => (list || []).map((u, i) => Object.assign({}, u, {
          rank: i + 1,
          medal: medal[i] || String(i + 1),
          isMe: u.openid === self.getMyOpenid()
        }))
        this.setData({
          byPoints: decorate(res.byPoints),
          byDonate: decorate(res.byDonate),
          loading: false
        })
      })
      .catch(e => {
        this.setData({ loading: false })
        wx.showToast({ title: typeof e === 'string' ? e : '加载失败', icon: 'none' })
      })
      .then(() => wx.stopPullDownRefresh())
  },

  getMyOpenid() {
    const app = getApp()
    return app.getOpenid ? app.getOpenid() : ''
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ activeTab: tab })
  }
})
