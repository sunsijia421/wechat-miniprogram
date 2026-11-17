// 流向公示（第二批）：展示物资去向，回应"捐给谁了、有没有真帮到"的信任诉求
const util = require('../../utils/util')

Page({
  data: {
    list: [],
    loading: true
  },

  onLoad() {
    this.loadFlow()
  },

  onShow() {
    this.loadFlow()
  },

  onPullDownRefresh() {
    this.loadFlow(() => wx.stopPullDownRefresh())
  },

  loadFlow(done) {
    util.callApi('flowList')
      .then(res => {
        const list = (res.list || []).map(c => {
          c.categoryName = util.getCategoryName(c.category)
          c.handoverName = this.handoverName(c.handoverMethod)
          return c
        })
        this.setData({ list, loading: false })
        if (done) done()
      })
      .catch(() => {
        this.setData({ loading: false })
        wx.showToast({ title: '加载失败', icon: 'none' })
        if (done) done()
      })
  },

  handoverName(m) {
    const map = { pickup: '🤝 当面自取', station: '🏠 村镇代收点', volunteer: '🚗 志愿者捎带', mail: '📮 邮寄到付' }
    return map[m] || '🤝 当面自取'
  },

  goItem(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
  }
})
