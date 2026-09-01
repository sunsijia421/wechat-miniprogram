const util = require('../../utils/util')

Page({
  data: {
    isAdmin: false,
    checked: false,
    loading: true,
    reports: []
  },

  onShow() {
    this.checkAndLoad()
  },

  // 校验管理员身份并加载举报列表
  checkAndLoad() {
    util.callApi('isAdmin')
      .then(res => {
        this.setData({ isAdmin: res.isAdmin, checked: true })
        if (res.isAdmin) {
          this.loadReports()
        } else {
          this.setData({ loading: false })
        }
      })
      .catch(() => {
        this.setData({ checked: true, isAdmin: false, loading: false })
      })
  },

  // 加载全部举报
  loadReports() {
    util.callApi('adminReports')
      .then(res => {
        const list = res.list.map(r => this.normalizeReport(r))
        this.setData({ reports: list, loading: false })
      })
      .catch(e => {
        this.setData({ loading: false })
        wx.showToast({ title: typeof e === 'string' ? e : '加载失败', icon: 'none' })
      })
  },

  // 统一处理举报字段
  normalizeReport(r) {
    return Object.assign({}, r, {
      id: r._id,
      createTimeStr: util.formatTime(r.createTime),
      statusText: r.status === 'handled'
        ? (r.result === 'offline' ? '已下架' : '已忽略')
        : '待处理',
      itemStatusText: r.itemStatus === 'offline' ? '已下架'
        : r.itemStatus === 'completed' ? '已送出'
        : r.itemStatus === 'deleted' ? '已删除' : '可领取'
    })
  },

  // 跳转物品详情
  goDetail(e) {
    const itemId = e.currentTarget.dataset.itemid
    if (!itemId) return
    wx.navigateTo({ url: '/pages/detail/detail?id=' + itemId })
  },

  // 处理举报：offline=下架物品；ignore=忽略单条
  handleReport(e) {
    const action = e.currentTarget.dataset.action
    const itemId = e.currentTarget.dataset.itemid
    const reportId = e.currentTarget.dataset.id
    const isOffline = action === 'offline'
    const that = this
    wx.showModal({
      title: isOffline ? '下架该物品' : '忽略举报',
      content: isOffline
        ? '确认下架该物品吗？下架后将从公开列表隐藏。'
        : '确认忽略该举报（认为物品合规）吗？',
      confirmText: isOffline ? '确认下架' : '确认忽略',
      confirmColor: isOffline ? '#f44336' : '#4CAF50',
      cancelText: '取消',
      success: function (res) {
        if (!res.confirm) return
        util.callApi('handleReport', { itemId: itemId, reportId: reportId, action: action })
          .then(() => {
            that.loadReports()
            wx.showToast({ title: isOffline ? '物品已下架' : '已忽略', icon: 'success' })
          })
          .catch(e => {
            wx.showToast({ title: typeof e === 'string' ? e : '操作失败', icon: 'none' })
          })
      }
    })
  },

  goBack() {
    wx.navigateBack()
  },

  // 返回用户端（切回首页）
  backToUser() {
    wx.switchTab({ url: '/pages/index/index' })
  }
})
