// 已开通的云开发环境ID（微信公众平台后台 -> 云服务 -> 云开发）
const CLOUD_ENV = 'cloudbase-d4ghpbagzd02ea714'

App({
  globalData: {
    userInfo: null,
    isAgreed: false,
    openid: '',
    cloudReady: false
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('当前基础库不支持云开发，请使用 2.2.3 或以上版本')
      return
    }
    wx.cloud.init({
      env: CLOUD_ENV,
      traceUser: true
    })
    this.globalData.cloudReady = true

    const isAgreed = wx.getStorageSync('isAgreed')
    if (isAgreed) this.globalData.isAgreed = true

    const userInfo = wx.getStorageSync('userInfo')
    if (userInfo) this.globalData.userInfo = userInfo

    const openid = wx.getStorageSync('openid')
    if (openid) this.globalData.openid = openid

    console.log('佳禾换物小站小程序启动')
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

  // 保存 openid
  setOpenid(openid) {
    this.globalData.openid = openid
    wx.setStorageSync('openid', openid)
  },

  // 获取 openid
  getOpenid() {
    if (!this.globalData.openid) {
      this.globalData.openid = wx.getStorageSync('openid')
    }
    return this.globalData.openid
  },

  // 更新用户积分和捐赠次数（本地即时反馈，云端 users 集合为权威值）
  updateUserStats(points, donateCount) {
    const userInfo = this.getUserInfo()
    if (userInfo) {
      userInfo.points = (userInfo.points || 0) + points
      userInfo.donateCount = (userInfo.donateCount || 0) + donateCount
      this.saveUserInfo(userInfo)
    }
  }
})
