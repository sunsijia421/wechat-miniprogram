const util = require('../../utils/util')
const app = getApp()

Page({
  data: {
    title: '',
    description: '',
    category: 'books',
    categoryIndex: 0,
    allowBarter: false,
    images: [],
    location: null,
    locationName: '',

    categories: ['📚 书籍', '👔 衣物', '💻 数码产品' ,'日用品','📦 其他'],
    categoryValues: ['books', 'clothes', 'electronics', 'other'],

    submitting: false,

    // 关键：data 初始化时直接从 storage 读取，首次渲染就是正确状态，不需 setData 修正
    isLoggedIn: !!wx.getStorageSync('userInfo')
  },

  onShow() {
    // 只在登录状态真正变化时才更新（如在个人中心退出登录后切回发布页）
    const loggedIn = !!wx.getStorageSync('userInfo')
    if (this.data.isLoggedIn !== loggedIn) {
      this.setData({ isLoggedIn: loggedIn })
    }
  },

  // 跳转去登录
  goToLogin() {
    wx.switchTab({ url: '/pages/index/index' })
  },

  // 输入标题
  onTitleInput(e) {
    this.setData({ title: e.detail.value })
  },

  // 输入描述
  onDescInput(e) {
    this.setData({ description: e.detail.value })
  },

  // 选择分类
  onCategoryChange(e) {
    const index = e.detail.value
    this.setData({
      categoryIndex: index,
      category: this.data.categoryValues[index]
    })
  },

  // 切换以物易物
  onBarterChange(e) {
    this.setData({ allowBarter: e.detail.value })
  },

  // 选择图片
  chooseImage() {
    const { images } = this.data
    const remainCount = 4 - images.length
    if (remainCount <= 0) {
      wx.showToast({ title: '最多上传4张图片', icon: 'none' })
      return
    }

    wx.chooseImage({
      count: remainCount,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        this.setData({
          images: [...images, ...res.tempFilePaths]
        })
      }
    })
  },

  // 删除图片
  deleteImage(e) {
    const index = e.currentTarget.dataset.index
    const images = this.data.images
    images.splice(index, 1)
    this.setData({ images })
  },

  // 预览图片
  previewImage(e) {
    const index = e.currentTarget.dataset.index
    wx.previewImage({
      current: this.data.images[index],
      urls: this.data.images
    })
  },

  // 选择位置
  chooseLocation() {
    wx.chooseLocation({
      success: (res) => {
        this.setData({
          location: {
            lat: res.latitude,
            lng: res.longitude,
            name: res.name,
            address: res.address
          },
          locationName: res.name || res.address || '已选择位置'
        })
      },
      fail: (err) => {
        if (err.errMsg.indexOf('cancel') === -1) {
          wx.showToast({ title: '选择位置失败', icon: 'none' })
        }
      }
    })
  },

  // 清除位置
  clearLocation() {
    this.setData({
      location: null,
      locationName: ''
    })
  },

  // 提交物品
  submitItem() {
    // 先检查登录状态
    if (!this.data.isLoggedIn) {
      wx.showToast({ title: '请先在首页登录', icon: 'none' })
      return
    }

    // 校验
    const { title, description, images, submitting } = this.data
    if (submitting) return

    if (!title.trim()) {
      wx.showToast({ title: '请输入物品标题', icon: 'none' })
      return
    }
    if (title.trim().length > 30) {
      wx.showToast({ title: '标题不能超过30个字', icon: 'none' })
      return
    }
    if (!description.trim()) {
      wx.showToast({ title: '请输入物品描述', icon: 'none' })
      return
    }

    // 内容安全审核 - 文本
    var textCheck = util.checkTextContent(title + ' ' + description)
    if (!textCheck.passed) {
      wx.showModal({
        title: '内容安全提醒',
        content: '您的发布内容包含敏感词"' + textCheck.word + '"，请修改后再发布。\n\n本平台禁止任何形式的金钱交易。',
        showCancel: false,
        confirmText: '我知道了'
      })
      return
    }

    // 内容安全审核 - 图片
    var imgCheck = util.checkImageContent(images)
    if (!imgCheck.passed) {
      wx.showToast({ title: imgCheck.message, icon: 'none' })
      return
    }

    this.setData({ submitting: true })

    const userInfo = app.getUserInfo()

    // 构建物品数据
    var now = Date.now()
    const item = {
      id: util.generateId(),
      title: title.trim(),
      description: description.trim(),
      category: this.data.category,
      categoryName: util.getCategoryName(this.data.category),
      images: this.data.images,
      allowBarter: this.data.allowBarter,
      location: this.data.location,
      locationName: this.data.locationName || '',
      status: 'available',
      publisherId: userInfo.nickName,
      publisherNickName: userInfo.nickName,
      publisherAvatarUrl: userInfo.avatarUrl,
      createTime: now,
      createTimeStr: util.formatTime(now),
      completeTime: null
    }

    // 保存到本地存储
    const items = wx.getStorageSync('items') || []
    items.push(item)
    wx.setStorageSync('items', items)

    // 提示成功
    wx.showToast({
      title: '发布成功！',
      icon: 'success',
      duration: 1500
    })

    // 重置表单
    setTimeout(() => {
      this.setData({
        title: '',
        description: '',
        category: 'books',
        categoryIndex: 0,
        allowBarter: false,
        images: [],
        location: null,
        locationName: '',
        submitting: false
      })
    }, 1500)
  }
})
