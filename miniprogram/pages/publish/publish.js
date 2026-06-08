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

    categories: ['📚 书籍', '👔 衣物', '💻 电子产品', '📦 其他'],
    categoryValues: ['books', 'clothes', 'electronics', 'other'],

    submitting: false
  },

  onLoad() {
    // 检查登录状态
    const userInfo = app.getUserInfo()
    if (!userInfo) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      setTimeout(() => {
        wx.switchTab({ url: '/pages/index/index' })
      }, 1500)
    }
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
    // 校验
    const { title, description, submitting } = this.data
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

    this.setData({ submitting: true })

    const userInfo = app.getUserInfo()

    // 构建物品数据
    const item = {
      id: util.generateId(),
      title: title.trim(),
      description: description.trim(),
      category: this.data.category,
      categoryName: util.getCategoryName(this.data.category),
      allowBarter: this.data.allowBarter,
      images: this.data.images,
      location: this.data.location,
      locationName: this.data.locationName,
      status: 'available', // available | completed
      createTime: Date.now(),
      createTimeStr: util.formatTime(Date.now()),
      // 发布者信息（发布时记录，避免后续用户信息变更影响）
      publisherNickName: userInfo.nickName,
      publisherAvatarUrl: userInfo.avatarUrl
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
