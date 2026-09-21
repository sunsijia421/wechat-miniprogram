const app = getApp()
const util = require('../../utils/util')

// P7：积分商城——徽章兑换 + 幸运抽奖 + 抽奖记录
Page({
  data: {
    points: 0,
    badges: [],
    myBadgeIds: [],
    // 抽奖
    showLotteryModal: false,
    lotteryResult: null,
    lotteryRecords: [],
    drawing: false
  },

  onShow() {
    const userInfo = app.getUserInfo() || {}
    this.setData({ points: userInfo.points || 0 })
    this.loadBadges()
    this.loadLotteries()
  },

  // 徽章目录 + 已拥有
  loadBadges() {
    util.callApi('badgeList', {})
      .then(res => {
        const myBadgeIds = (res.myBadges || []).map(b => b.badgeId)
        const badges = (res.list || []).map(b => Object.assign({}, b, {
          owned: myBadgeIds.indexOf(b.id) >= 0,
          points: b.price
        }))
        this.setData({ badges, myBadgeIds })
      })
      .catch(() => {})
  },

  // 抽奖记录
  loadLotteries() {
    util.callApi('myLotteries', {})
      .then(res => {
        this.setData({ lotteryRecords: res.list || [] })
      })
      .catch(() => {})
  },

  // 兑换徽章
  exchangeBadge(e) {
    const id = e.currentTarget.dataset.id
    const badge = (this.data.badges || []).find(b => b.id === id)
    if (!badge) return
    if (badge.owned) {
      wx.showToast({ title: '已拥有该徽章', icon: 'none' })
      return
    }
    if (this.data.points < badge.points) {
      wx.showToast({ title: '积分不足，可去发布/送出物品赚积分', icon: 'none' })
      return
    }
    const that = this
    wx.showModal({
      title: '兑换徽章',
      content: `花费 ${badge.points} 积分兑换「${badge.name}」徽章吗？`,
      confirmText: '兑换',
      cancelText: '取消',
      success(res) {
        if (!res.confirm) return
        util.callApi('exchangeBadge', { badgeId: id })
          .then(() => {
            app.updateUserStats(-badge.points, 0)
            that.setData({ points: (that.data.points || 0) - badge.points })
            that.loadBadges()
            wx.showToast({ title: '兑换成功 🎉', icon: 'success' })
          })
          .catch(err => {
            wx.showToast({ title: typeof err === 'string' ? err : '兑换失败', icon: 'none' })
          })
      }
    })
  },

  // 打开抽奖弹窗
  openLottery() {
    if (this.data.points < 10) {
      wx.showToast({ title: '积分不足10分，无法抽奖', icon: 'none' })
      return
    }
    this.setData({ showLotteryModal: true, lotteryResult: null })
  },

  closeLottery() {
    if (this.data.drawing) return
    this.setData({ showLotteryModal: false })
  },

  // 执行抽奖（10分/次）
  doLottery() {
    if (this.data.drawing) return
    if (this.data.points < 10) {
      wx.showToast({ title: '积分不足10分', icon: 'none' })
      return
    }
    this.setData({ drawing: true })
    util.callApi('lottery', {})
      .then(res => {
        const r = res.result || {}
        const net = res.netPoints != null ? res.netPoints : -10
        app.updateUserStats(net, 0)
        const points = (this.data.points || 0) + net
        this.setData({
          points,
          lotteryResult: {
            text: r.text || '谢谢参与',
            points: r.points || 0,
            title: r.title || ''
          },
          drawing: false
        })
        this.loadLotteries()
      })
      .catch(err => {
        this.setData({ drawing: false })
        wx.showToast({ title: typeof err === 'string' ? err : '抽奖失败', icon: 'none' })
      })
  },

  // 查看积分获取方式说明
  goPointLogs() {
    wx.navigateTo({ url: '/pages/pointLogs/pointLogs' })
  }
})
