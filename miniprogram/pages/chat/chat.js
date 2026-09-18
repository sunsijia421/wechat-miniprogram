const util = require('../../utils/util')

Page({
  data: {
    convId: '',
    messages: [],
    inputValue: '',
    peerName: '',
    itemTitle: '',
    sending: false,
    scrollIntoView: '',
    loaded: false
  },

  onLoad(options) {
    const convId = options.convId
    if (!convId) {
      wx.showToast({ title: '会话不存在', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1000)
      return
    }
    this.setData({ convId })
    this.loadMessages()
  },

  onShow() {
    this._hidden = false
    if (this.data.convId) this.loadMessages()
  },

  onHide() {
    this._hidden = true
  },

  // 加载消息 + 轮询新消息（每 5 秒）
  loadMessages() {
    const app = getApp()
    const myInfo = app.getUserInfo() || {}
    util.callApi('conversationMessages', { convId: this.data.convId })
      .then(res => {
        this.setData({
          messages: res.list,
          peerName: res.peerName || '',
          peerAvatar: res.peerAvatar || '',
          myAvatar: myInfo.avatarUrl || '',
          itemTitle: res.itemTitle || '',
          loaded: true
        })
        this.scrollToBottom()
        this.startPolling()
      })
      .catch(e => {
        wx.showToast({ title: typeof e === 'string' ? e : '加载失败', icon: 'none' })
      })
  },

  startPolling() {
    clearInterval(this._pollTimer)
    this._pollTimer = setInterval(() => {
      // 页面可见时才轮询，避免后台耗电
      if (!this._hidden) this.loadMessages()
    }, 5000)
  },

  onUnload() {
    clearInterval(this._pollTimer)
  },

  onInput(e) {
    this.setData({ inputValue: e.detail.value })
  },

  sendMessage() {
    const content = (this.data.inputValue || '').trim()
    if (!content) return
    if (this.data.sending) return

    // 本地敏感词预校验
    const textCheck = util.checkTextContent(content)
    if (!textCheck.passed) {
      wx.showToast({ title: '内容包含敏感词，请修改', icon: 'none' })
      return
    }

    this.setData({ sending: true })
    util.callApi('sendMessage', { convId: this.data.convId, content })
      .then(() => {
        this.setData({ inputValue: '' })
        this.loadMessages()
        this.setData({ sending: false })
      })
      .catch(e => {
        this.setData({ sending: false })
        wx.showToast({ title: typeof e === 'string' ? e : '发送失败', icon: 'none' })
      })
  },

  scrollToBottom() {
    const msgs = this.data.messages
    if (msgs.length) {
      this.setData({ scrollIntoView: 'msg-' + msgs[msgs.length - 1].id })
    }
  },

  // 跳转物品详情
  goItem() {
    // 会话页没有直接拿 itemId，从消息列表进入已携带；这里通过页面栈拿不到就返回列表
    wx.navigateBack()
  }
})
