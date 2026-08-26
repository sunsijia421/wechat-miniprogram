const util = require('../../utils/util')
const app = getApp()

Page({
  data: {
    itemId: '',
    title: '',
    description: '',
    category: 'books',
    categoryIndex: 0,
    allowBarter: false,
    // images 混合存储：云 fileID（cloud:// 开头）或本地临时路径；imageUrls 与之对齐用于展示
    images: [],
    imageUrls: [],
    location: null,
    locationName: '',

    categories: ['📚 书籍', '👔 衣物', '💻 电子产品', '📦 其他'],
    categoryValues: ['books', 'clothes', 'electronics', 'other'],

    submitting: false,
    loading: true
  },

  onLoad(options) {
    const itemId = options.id
    if (!itemId) {
      wx.showToast({ title: '物品不存在', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
      return
    }
    if (!util.requireLogin()) return
    this.setData({ itemId })
    this.loadItem()
  },

  // 加载物品并预填表单
  loadItem() {
    util.callApi('detail', { id: this.data.itemId })
      .then(res => {
        const item = res.item
        if (!res.isOwner) {
          wx.showToast({ title: '无权编辑该物品', icon: 'none' })
          setTimeout(() => wx.navigateBack(), 1500)
          return
        }
        const categoryIndex = Math.max(0, this.data.categoryValues.indexOf(item.category || 'books'))
        this.setData({
          title: item.title || '',
          description: item.description || '',
          category: item.category || 'books',
          categoryIndex: categoryIndex,
          allowBarter: !!item.allowBarter,
          location: item.location || null,
          locationName: item.locationName || '',
          loading: false
        })
        this.setImages(item.images || [])
      })
      .catch(e => {
        wx.showToast({ title: typeof e === 'string' ? e : '加载失败', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 1500)
      })
  },

  // 设置图片：区分云 fileID 与本地临时路径，fileID 转临时 URL 供展示
  setImages(images) {
    const fileIDs = images.filter(u => u.indexOf('cloud://') === 0)
    if (!fileIDs.length) {
      this.setData({ images: images, imageUrls: images })
      return
    }
    wx.cloud.getTempFileURL({
      fileList: fileIDs,
      success: (res) => {
        const urlMap = {}
        ;(res.fileList || []).forEach(f => { urlMap[f.fileID] = f.tempFileURL || f.fileID })
        const imageUrls = images.map(u => (u.indexOf('cloud://') === 0 ? (urlMap[u] || u) : u))
        this.setData({ images: images, imageUrls: imageUrls })
      },
      fail: () => {
        this.setData({ images: images, imageUrls: images })
      }
    })
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

  onBarterChange(e) {
    this.setData({ allowBarter: e.detail.value })
  },

  // 选择新图片
  chooseImage() {
    const remainCount = 4 - this.data.images.length
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
          images: [...this.data.images, ...paths],
          imageUrls: [...this.data.imageUrls, ...paths]
        })
      }
    })
  },

  // 删除图片
  deleteImage(e) {
    const index = e.currentTarget.dataset.index
    const images = this.data.images
    const imageUrls = this.data.imageUrls
    images.splice(index, 1)
    imageUrls.splice(index, 1)
    this.setData({ images, imageUrls })
  },

  // 预览图片
  previewImage(e) {
    const index = e.currentTarget.dataset.index
    wx.previewImage({
      current: this.data.imageUrls[index],
      urls: this.data.imageUrls
    })
  },

  // 选择位置
  chooseLocation() {
    wx.chooseLocation({
      success: (res) => {
        this.setData({
          location: { lat: res.latitude, lng: res.longitude, name: res.name, address: res.address },
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
    this.setData({ location: null, locationName: '' })
  },

  // 保存修改
  submit() {
    if (this.data.submitting) return
    const { title, description } = this.data
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

    const textCheck = util.checkTextContent(title + ' ' + description)
    if (!textCheck.passed) {
      wx.showModal({
        title: '内容安全提醒',
        content: '内容包含敏感词"' + textCheck.word + '"，请修改后再保存。\n\n本平台禁止任何形式的金钱交易。',
        showCancel: false,
        confirmText: '我知道了'
      })
      return
    }

    this.setData({ submitting: true })

    // 已有 fileID 直接保留，本地临时路径先上传为 fileID
    const uploadTasks = this.data.images.map(u => {
      if (u.indexOf('cloud://') === 0) return Promise.resolve(u)
      return this.uploadOne(u)
    })
    Promise.all(uploadTasks)
      .then(fileIDs => {
        return util.callApi('update', {
          id: this.data.itemId,
          title: title.trim(),
          description: description.trim(),
          category: this.data.category,
          images: fileIDs,
          allowBarter: this.data.allowBarter,
          location: this.data.location,
          locationName: this.data.locationName || ''
        })
      })
      .then(() => {
        wx.showToast({ title: '保存成功', icon: 'success', duration: 1200 })
        setTimeout(() => wx.navigateBack(), 1200)
      })
      .catch(err => {
        this.setData({ submitting: false })
        wx.showToast({ title: typeof err === 'string' ? err : '保存失败，请重试', icon: 'none' })
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
  }
})
