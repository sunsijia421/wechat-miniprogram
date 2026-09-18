const util = require('../../utils/util')

Page({
  data: {
    logs: [],
    loading: false,
    totalPoints: 0,
    totalDonate: 0
  },

  onShow() {
    if (!util.requireLogin()) return
    this.loadLogs()
  },

  onPullDownRefresh() {
    this.loadLogs(true)
  },

  loadLogs(isRefresh) {
    if (this.data.loading && !isRefresh) return
    this.setData({ loading: true })
    util.callApi('pointLogs', {})
      .then(res => {
        const list = res.list || []
        const totalPoints = list.reduce((s, l) => s + (l.points || 0), 0)
        const totalDonate = list.reduce((s, l) => s + (l.donateCount || 0), 0)
        this.setData({ logs: list, loading: false, totalPoints, totalDonate })
      })
      .catch(e => {
        this.setData({ loading: false })
        wx.showToast({ title: typeof e === 'string' ? e : '加载失败', icon: 'none' })
      })
      .then(() => wx.stopPullDownRefresh())
  }
})
