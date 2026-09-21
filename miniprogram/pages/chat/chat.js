const util = require('../../utils/util')

Page({
  data: {
    convId: '',
    messages: [],
    inputValue: '',
    peerName: '',
    peerAvatar: '',
    peerOpenid: '',
    itemTitle: '',
    isWish: false,
    sending: false,
    scrollIntoView: '',
    loaded: false,
    // P7：拉黑状态
    iBlocked: false,
    blockedBy: false,
    blockInputDisabled: false
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
    util.refreshMessageBadge()
  },

  // 加载消息 + 轮询新消息（每 5 秒）
  loadMessages() {
    const app = getApp()
    const myInfo = app.getUserInfo() || {}
    const that = this
    util.callApi('conversationMessages', { convId: this.data.convId })
      .then(res => {
        const list = res.list || []
        // 限发判断：我是申请者 && 对方（发布者）尚未回复 && 我已发过至少 1 条 → 显示"仅可再发一条"提示
        let canSendOneOnly = false
        if (res.role === 'applicant') {
          const peerReplied = list.some(m => !m.isMine)
          const mySent = list.filter(m => m.isMine).length
          canSendOneOnly = !peerReplied && mySent >= 1
        }
        this.setData({
          messages: list,
          peerName: res.peerName || '',
          peerAvatar: res.peerAvatar || '',
          peerOpenid: res.peerOpenid || '',
          myAvatar: myInfo.avatarUrl || '',
          itemTitle: res.itemTitle || '',
          isWish: !!res.wishId,
          loaded: true,
          canSendOneOnly
        })
        // 导航栏标题改成对方昵称
        if (res.peerName) {
          wx.setNavigationBarTitle({ title: res.peerName })
        }
        this.scrollToBottom()
        this.startPolling()
        // P7：检查与对方的拉黑状态
        this.checkBlockStatus()
      })
      .catch(e => {
        wx.showToast({ title: typeof e === 'string' ? e : '加载失败', icon: 'none' })
      })
  },

  // P7：拉黑状态检查（双方任一方拉黑则禁用输入）
  checkBlockStatus() {
    if (!this.data.peerOpenid) return
    const that = this
    util.callApi('blockStatus', { targetOpenid: this.data.peerOpenid })
      .then(res => {
        const disabled = !!res.iBlocked || !!res.blockedBy
        that.setData({
          iBlocked: !!res.iBlocked,
          blockedBy: !!res.blockedBy,
          blockInputDisabled: disabled
        })
      })
      .catch(() => {})
  },

  // P7：拉黑 / 取消拉黑
  toggleBlock() {
    const that = this
    if (this.data.iBlocked) {
      wx.showModal({
        title: '取消拉黑',
        content: '取消拉黑后，你们可以继续聊天和申请物品。',
        confirmText: '取消拉黑',
        cancelText: '暂不',
        success(res) {
          if (!res.confirm) return
          util.callApi('unblockUser', { targetOpenid: that.data.peerOpenid })
            .then(() => {
              that.setData({ iBlocked: false, blockInputDisabled: false })
              wx.showToast({ title: '已取消拉黑', icon: 'success' })
            })
            .catch(e => wx.showToast({ title: typeof e === 'string' ? e : '操作失败', icon: 'none' }))
        }
      })
      return
    }
    wx.showModal({
      title: '拉黑对方',
      content: '拉黑后对方将无法给你发消息、无法申请你的物品，且你无法给对方发消息。',
      confirmText: '拉黑',
      confirmColor: '#f44336',
      cancelText: '取消',
      success(res) {
        if (!res.confirm) return
        util.callApi('blockUser', { targetOpenid: that.data.peerOpenid })
          .then(() => {
            that.setData({ iBlocked: true, blockInputDisabled: true })
            wx.showToast({ title: '已拉黑', icon: 'none' })
          })
          .catch(e => wx.showToast({ title: typeof e === 'string' ? e : '操作失败', icon: 'none' }))
      }
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
    util.refreshMessageBadge()
  },

  onInput(e) {
    this.setData({ inputValue: e.detail.value })
  },

  sendMessage() {
    const content = (this.data.inputValue || '').trim()
    if (!content) return
    if (this.data.sending) return
    // P7：拉黑状态下禁止发送
    if (this.data.blockInputDisabled) {
      wx.showToast({ title: this.data.blockedBy ? '对方已拉黑你，无法发送' : '你已拉黑对方，无法发送', icon: 'none' })
      return
    }

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
