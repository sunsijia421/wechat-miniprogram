const app = getApp()
const util = require('../../utils/util')

Page({
  data: {
    nickName: '',
    avatarUrl: '',
    bio: '',
    region: '',
    shortOpenid: '',
    points: 0,
    donateCount: 0,
    level: { name: '初心者', icon: '🌱' },
    saving: false
  },

  onShow() {
    const userInfo = app.getUserInfo()
    const openid = app.getOpenid() || ''
    if (!userInfo) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1000)
      return
    }
    this.setData({
      nickName: userInfo.nickName || '',
      avatarUrl: userInfo.avatarUrl || '',
      bio: userInfo.bio || '',
      region: userInfo.region || '',
      shortOpenid: util.maskOpenid(openid),
      points: userInfo.points || 0,
      donateCount: userInfo.donateCount || 0,
      level: util.getLevel(userInfo.points)
    })
    // 以云端为准刷新积分（避免本地缓存滞后）
    util.callApi('userProfile', { openid }).then(res => {
      if (res.success !== false && res.points !== undefined) {
        const updated = Object.assign({}, userInfo, {
          points: res.points || 0,
          donateCount: res.donateCount || 0,
          nickName: res.nickName || userInfo.nickName,
          avatarUrl: res.avatarUrl || userInfo.avatarUrl,
          bio: res.bio || '',
          region: res.region || ''
        })
        app.saveUserInfo(updated)
        this.setData({
          points: updated.points,
          donateCount: updated.donateCount,
          nickName: updated.nickName,
          avatarUrl: updated.avatarUrl,
          bio: updated.bio,
          region: updated.region,
          level: util.getLevel(updated.points)
        })
      }
    }).catch(() => {})
  },

  // 微信新版头像选择
  onChooseAvatar(e) {
    this.setData({ avatarUrl: e.detail.avatarUrl })
  },

  onNicknameInput(e) {
    this.setData({ nickName: e.detail.value })
  },

  onBioInput(e) {
    this.setData({ bio: e.detail.value })
  },

  onRegionInput(e) {
    this.setData({ region: e.detail.value })
  },

  save() {
    if (this.data.saving) return
    const nickName = (this.data.nickName || '').trim()
    if (!nickName) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' })
      return
    }
    if ((this.data.bio || '').length > 100) {
      wx.showToast({ title: '简介不能超过100字', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    util.callApi('updateProfile', {
      nickName,
      avatarUrl: this.data.avatarUrl,
      bio: this.data.bio,
      region: this.data.region
    })
      .then(() => {
        // 同步本地全局用户信息
        const userInfo = app.getUserInfo() || {}
        userInfo.nickName = nickName
        userInfo.avatarUrl = this.data.avatarUrl
        userInfo.bio = this.data.bio
        userInfo.region = this.data.region
        app.saveUserInfo(userInfo)
        wx.showToast({ title: '保存成功', icon: 'success' })
        this.setData({ saving: false })
        setTimeout(() => wx.navigateBack(), 1200)
      })
      .catch(e => {
        this.setData({ saving: false })
        wx.showToast({ title: typeof e === 'string' ? e : '保存失败', icon: 'none' })
      })
  },

  goAgreement() {
    wx.navigateTo({ url: '/pages/agreement/agreement' })
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后需要重新授权才能使用',
      confirmText: '退出',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          wx.removeStorageSync('userInfo')
          wx.removeStorageSync('isAgreed')
          wx.removeStorageSync('openid')
          wx.removeStorageSync('isAdmin')
          app.globalData.userInfo = null
          app.globalData.isAgreed = false
          app.globalData.openid = ''
          app.globalData.isAdmin = false
          wx.showToast({ title: '已退出', icon: 'success' })
          setTimeout(() => {
            wx.switchTab({ url: '/pages/index/index' })
          }, 1000)
        }
      }
    })
  }
})
