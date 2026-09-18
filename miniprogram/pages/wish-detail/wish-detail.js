// 求购详情（P6）：查看 + 我有闲置联系TA
const util = require('../../utils/util')

Page({
  data: {
    id: '',
    wish: null,
    showOfferModal: false,
    offerMessage: '',
    submitting: false,
    isLoggedIn: false
  },

  onLoad(options) {
    this.setData({ id: options.id || '', isLoggedIn: !!wx.getStorageSync('userInfo') })
    this.loadDetail()
  },

  onShow() {
    this.setData({ isLoggedIn: !!wx.getStorageSync('userInfo') })
  },

  loadDetail() {
    if (!this.data.id) {
      wx.showToast({ title: '求购不存在', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1200)
      return
    }
    util.callApi('wishDetail', { id: this.data.id })
      .then(res => {
        const w = res.wish
        w.categoryName = util.getCategoryName(w.category)
        w.statusText = w.status === 'open' ? '进行中' : '已满足'
        this.setData({ wish: w })
      })
      .catch(e => {
        wx.showToast({ title: typeof e === 'string' ? e : '加载失败', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 1200)
      })
  },

  // 我有闲置，联系TA
  openOffer() {
    if (!util.requireLogin()) return
    const w = this.data.wish
    if (!w || w.isMine) return
    if (w.status !== 'open') {
      wx.showToast({ title: '该求购已结束', icon: 'none' })
      return
    }
    this.setData({ showOfferModal: true, offerMessage: '' })
  },

  closeOffer() {
    this.setData({ showOfferModal: false })
  },

  stopPropagation() {},

  onOfferInput(e) {
    this.setData({ offerMessage: e.detail.value })
  },

  submitOffer() {
    const msg = this.data.offerMessage.trim()
    if (!msg) {
      wx.showToast({ title: '请填写留言', icon: 'none' })
      return
    }
    const textCheck = util.checkTextContent(msg)
    if (!textCheck.passed) {
      wx.showToast({ title: '留言包含敏感词，请修改', icon: 'none' })
      return
    }
    if (this.data.submitting) return
    this.setData({ submitting: true })

    // 先请求订阅授权（通知求购者），授权失败不影响
    const that = this
    util.requestSubscribe('applyNotice').then(() => {
      that.doSubmitOffer(msg)
    }, () => {
      that.doSubmitOffer(msg)
    })
  },

  doSubmitOffer(msg) {
    util.callApi('offerWish', { wishId: this.data.id, message: msg })
      .then(res => {
        this.setData({ showOfferModal: false, submitting: false })
        wx.showToast({ title: '已联系求购者', icon: 'success' })
        setTimeout(() => {
          if (res.convId) {
            wx.navigateTo({ url: '/pages/chat/chat?convId=' + res.convId })
          } else {
            wx.navigateBack()
          }
        }, 1200)
      })
      .catch(e => {
        this.setData({ submitting: false })
        wx.showToast({ title: typeof e === 'string' ? e : '操作失败', icon: 'none' })
      })
  }
})
