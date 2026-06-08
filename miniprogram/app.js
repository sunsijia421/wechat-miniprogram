App({
  globalData: {
    userInfo: null,
    isAgreed: false
  },

  onLaunch() {
    // 读取本地存储的协议同意状态
    const isAgreed = wx.getStorageSync('isAgreed')
    if (isAgreed) {
      this.globalData.isAgreed = true
    }

    // 读取本地存储的用户信息
    const userInfo = wx.getStorageSync('userInfo')
    if (userInfo) {
      this.globalData.userInfo = userInfo
    }

    console.log('校园物资公益流转小程序启动')
    console.log('用户信息：', this.globalData.userInfo)
    console.log('协议同意：', this.globalData.isAgreed)
  },

  // 检查是否已同意协议
  checkAgreed() {
    return this.globalData.isAgreed || wx.getStorageSync('isAgreed')
  },

  // 设置协议同意
  setAgreed() {
    this.globalData.isAgreed = true
    wx.setStorageSync('isAgreed', true)
  },

  // 保存用户信息
  saveUserInfo(userInfo) {
    this.globalData.userInfo = userInfo
    wx.setStorageSync('userInfo', userInfo)
  },

  // 获取用户信息
  getUserInfo() {
    if (!this.globalData.userInfo) {
      this.globalData.userInfo = wx.getStorageSync('userInfo')
    }
    return this.globalData.userInfo
  },

  // 更新用户积分和捐赠次数
  updateUserStats(points, donateCount) {
    const userInfo = this.getUserInfo()
    if (userInfo) {
      userInfo.points = (userInfo.points || 0) + points
      userInfo.donateCount = (userInfo.donateCount || 0) + donateCount
      this.saveUserInfo(userInfo)
    }
  }
})
