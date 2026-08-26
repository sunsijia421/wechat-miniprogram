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

    wx.chooseMedia({
      count: remainCount,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const paths = res.tempFiles.map(f => f.tempFilePath)
        this.setData({
          images: [...images, ...paths]
        })
      },
      fail: (err) => {
        if (err.errMsg && err.errMsg.indexOf('cancel') === -1) {
          wx.showModal({
            title: '无法打开相册',
            content: '请在「设置」中允许本小程序使用相册，并确认已在小程序后台配置《用户隐私保护指引》。',
            showCancel: false,
            confirmText: '我知道了'
          })
        }
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
        if (err.errMsg && err.errMsg.indexOf('cancel') === -1) {
          wx.showModal({
            title: '无法获取位置',
            content: '请在「设置」中允许本小程序使用位置信息，并确认已在小程序后台配置《用户隐私保护指引》中的位置权限。',
            showCancel: false,
            confirmText: '我知道了'
          })
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

  // 提交物品（上传图片到云存储 + 云端发布）
  submitItem() {
    if (!this.data.isLoggedIn) {
      wx.showToast({ title: '请先在首页登录', icon: 'none' })
      return
    }

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

    // 本地文本预校验（主要依赖云端内容安全）
    const textCheck = util.checkTextContent(title + ' ' + description)
    if (!textCheck.passed) {
      wx.showModal({
        title: '内容安全提醒',
        content: '您的发布内容包含敏感词"' + textCheck.word + '"，请修改后再发布。\n\n本平台禁止任何形式的金钱交易。',
        showCancel: false,
        confirmText: '我知道了'
      })
      return
    }

    this.setData({ submitting: true })

    const userInfo = app.getUserInfo()

    // 先上传图片到云存储
    const uploadTasks = (images || []).map(p => this.uploadOne(p))
    Promise.all(uploadTasks)
      .then(fileIDs => {
        return util.callApi('publish', {
          title: title.trim(),
          description: description.trim(),
          category: this.data.category,
          images: fileIDs,
          allowBarter: this.data.allowBarter,
          location: this.data.location,
          locationName: this.data.locationName || '',
          publisherNickName: (userInfo && userInfo.nickName) || '公益参与者',
          publisherAvatarUrl: (userInfo && userInfo.avatarUrl) || ''
        })
      })
      .then(() => {
        wx.showToast({ title: '发布成功！', icon: 'success', duration: 1500 })
        setTimeout(() => { this.resetForm() }, 1500)
      })
      .catch(err => {
        this.setData({ submitting: false })
        wx.showToast({ title: typeof err === 'string' ? err : '发布失败，请重试', icon: 'none' })
      })
  },

  // 上传单张图片到云存储，返回 fileID
  uploadOne(tempPath) {
    return new Promise((resolve, reject) => {
      const m = tempPath.match(/\.(\w+)$/)
      const ext = m ? m[1] : 'png'
      const cloudPath = 'items/' + Date.now() + '_' + Math.floor(Math.random() * 1e6) + '.' + ext
      wx.cloud.uploadFile({
        cloudPath: cloudPath,
        filePath: tempPath,
        success: res => resolve(res.fileID),
        fail: err => reject(err)
      })
    })
  },

  // 重置表单
  resetForm() {
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
  }
})
