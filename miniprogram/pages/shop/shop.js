const app = getApp()
const util = require('../../utils/util')

// 积分商城（第二批改造）：爱心申领区（受助方凭公益积分申领物资）+ 荣誉徽章
// 幸运抽奖已移除——娱乐化功能与"积分实质化"定位相悖
Page({
  data: {
    points: 0,
    badges: [],
    myBadgeIds: [],
    claimItems: [],
    loadingClaim: true
  },

  onShow() {
    const userInfo = app.getUserInfo() || {}
    this.setData({ points: userInfo.points || 0 })
    this.loadBadges()
    this.loadClaimItems()
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

  // 爱心申领区：积分申领物资列表
  loadClaimItems() {
    util.callApi('list', { pointClaimOnly: true, page: 1, pageSize: 20 })
      .then(res => {
        const items = (res.list || []).map(it => Object.assign({}, it, {
          categoryName: util.getCategoryName(it.category)
        }))
        this.setData({ claimItems: items, loadingClaim: false })
        this.resolveImages(items)
      })
      .catch(() => {
        this.setData({ loadingClaim: false })
      })
  },

  // cloud:// fileID 批量转临时 URL
  resolveImages(items) {
    const fileIDs = items.map(it => it.image).filter(u => u && u.indexOf('cloud://') === 0)
    if (!fileIDs.length) return
    wx.cloud.getTempFileURL({
      fileList: fileIDs,
      success: res => {
        const urlMap = {}
        ;(res.fileList || []).forEach(f => { urlMap[f.fileID] = f.tempFileURL || f.fileID })
        const claimItems = this.data.claimItems.map(it => Object.assign({}, it, {
          image: urlMap[it.image] || it.image
        }))
        this.setData({ claimItems })
      },
      fail: () => {}
    })
  },

  // 查看申领物资详情（申领 = 正常申请流程，积分在确认收到时结算扣除）
  goClaim(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
  },

  // 兑换荣誉徽章
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

  // 查看积分获取方式说明
  goPointLogs() {
    wx.navigateTo({ url: '/pages/pointLogs/pointLogs' })
  }
})
