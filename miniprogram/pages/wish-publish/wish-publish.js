// 发布求购（P6）
const util = require('../../utils/util')

Page({
  data: {
    title: '',
    description: '',
    category: 'books',
    categoryIndex: 0,
    categories: ['📚 书籍', '👔 衣物', '💻 电子产品', '📦 其他'],
    categoryValues: ['books', 'clothes', 'electronics', 'other'],
    submitting: false
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value })
  },

  onDescInput(e) {
    this.setData({ description: e.detail.value })
  },

  onCategoryChange(e) {
    const index = e.detail.value
    this.setData({
      categoryIndex: index,
      category: this.data.categoryValues[index]
    })
  },

  submit() {
    if (this.data.submitting) return
    const title = this.data.title.trim()
    const description = this.data.description.trim()
    if (!title) {
      wx.showToast({ title: '请输入求购标题', icon: 'none' })
      return
    }
    if (title.length > 30) {
      wx.showToast({ title: '标题不能超过30个字', icon: 'none' })
      return
    }
    if (!description) {
      wx.showToast({ title: '请输入求购说明', icon: 'none' })
      return
    }

    // 本地敏感词预校验（云端还会做内容安全审核）
    const textCheck = util.checkTextContent(title + ' ' + description)
    if (!textCheck.passed) {
      wx.showModal({
        title: '内容安全提醒',
        content: '内容包含敏感词"' + textCheck.word + '"，请修改后再发布。',
        showCancel: false,
        confirmText: '我知道了'
      })
      return
    }

    this.setData({ submitting: true })
    util.callApi('publishWish', { title, description, category: this.data.category })
      .then(() => {
        wx.showToast({ title: '求购已发布！', icon: 'success', duration: 1500 })
        setTimeout(() => {
          wx.navigateBack()
        }, 1500)
      })
      .catch(e => {
        this.setData({ submitting: false })
        wx.showToast({ title: typeof e === 'string' ? e : '发布失败', icon: 'none' })
      })
  }
})
