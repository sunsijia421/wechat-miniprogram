const util = require('../../utils/util')

Page({
  data: {
    content: '',
    contact: '',
    submitting: false
  },

  onContentInput(e) {
    this.setData({ content: e.detail.value })
  },

  onContactInput(e) {
    this.setData({ contact: e.detail.value })
  },

  submit() {
    if (this.data.submitting) return
    const content = (this.data.content || '').trim()
    if (!content) {
      wx.showToast({ title: '请填写反馈内容', icon: 'none' })
      return
    }
    if (content.length > 500) {
      wx.showToast({ title: '内容不能超过500字', icon: 'none' })
      return
    }
    if (!util.requireLogin()) return
    this.setData({ submitting: true })
    util.callApi('submitFeedback', { content, contact: this.data.contact })
      .then(() => {
        wx.showToast({ title: '反馈成功，感谢支持！', icon: 'success' })
        setTimeout(() => wx.navigateBack(), 1200)
      })
      .catch(e => {
        this.setData({ submitting: false })
        wx.showToast({ title: typeof e === 'string' ? e : '提交失败', icon: 'none' })
      })
  }
})
