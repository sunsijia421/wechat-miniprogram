const util = require('../../utils/util')
const app = getApp()

Page({
  data: {
    // 统计数据
    completedCount: 0,
    availableCount: 0,

    // 视图模式：list | map
    viewMode: 'list',

    // 分类筛选
    categories: util.CATEGORY_LIST,
    categoryKeys: util.CATEGORY_KEYS,
    currentCategory: 'all',

    // 关键词搜索
    keyword: '',

    // 物品列表（云端）
    allItems: [],
    displayItems: [],

    // 分页
    page: 1,
    pageSize: 10,
    hasMore: true,
    loading: false,

    // 地图
    mapMarkers: [],
    mapLat: 30.45,
    mapLng: 114.4,
    mapScale: 14,

    // 登录与协议状态
    showAgreement: false,
    showPrivacy: false,
    showProfileSetup: false,
    isLoggedIn: false,
    avatarUrl: '',
    nickName: ''
  },

  onLoad() {
    this.initPrivacyAndLogin()
  },

  onShow() {
    this.loadItems(true)
    this.calculateStats()
  },

  // 微信隐私授权（合规必需，必须在调用定位等隐私接口前完成）
  initPrivacyAndLogin() {
    const that = this
    if (wx.getPrivacySetting) {
      wx.getPrivacySetting({
        success(res) {
          if (res.needAuthorization) {
            that.setData({ showPrivacy: true })
          } else {
            that.checkLogin()
          }
        },
        fail() {
          that.checkLogin()
        }
      })
    } else {
      that.checkLogin()
    }
  },

  onAgreePrivacy() {
    const that = this
    if (wx.requirePrivacyAuthorize) {
      wx.requirePrivacyAuthorize({
        success() {
          that.setData({ showPrivacy: false })
          that.checkLogin()
        },
        fail() {
          wx.showToast({ title: '需同意隐私协议后使用', icon: 'none' })
        }
      })
    } else {
      that.setData({ showPrivacy: false })
      that.checkLogin()
    }
  },

  // 检查登录状态
  checkLogin() {
    const isAgreed = app.checkAgreed()
    const userInfo = app.getUserInfo()

    if (!isAgreed) {
      this.setData({ showAgreement: true })
      return
    }

    if (!userInfo) {
      this.setData({ isLoggedIn: false })
      return
    }

    this.setData({ isLoggedIn: true })
  },

  // 同意公约
  onAgree() {
    app.setAgreed()
    this.setData({ showAgreement: false })
    const userInfo = app.getUserInfo()
    if (!userInfo) {
      this.setData({ showProfileSetup: true })
    } else {
      this.setData({ isLoggedIn: true })
    }
  },

  // 拒绝公约
  onDisagree() {
    wx.showModal({
      title: '提示',
      content: '需要同意《公益互助公约》才能使用小程序',
      showCancel: false,
      confirmText: '我知道了',
      success: () => {
        this.setData({ showAgreement: true })
      }
    })
  },

  // 未登录提示点击：进入资料填写
  onSetupProfileTap() {
    if (!app.checkAgreed()) {
      this.setData({ showAgreement: true })
      return
    }
    this.setData({ showProfileSetup: true })
  },

  // 选择头像（新版头像昵称能力）
  onChooseAvatar(e) {
    const avatarUrl = e.detail.avatarUrl
    this.setData({ avatarUrl })
  },

  // 输入昵称（新版头像昵称能力）
  onNicknameInput(e) {
    this.setData({ nickName: e.detail.value })
  },

  // 保存资料并同步云端登录
  onSaveProfile() {
    const nickName = (this.data.nickName || '').trim()
    if (!nickName) {
      wx.showToast({ title: '请填写昵称', icon: 'none' })
      return
    }
    const userInfo = {
      avatarUrl: this.data.avatarUrl || '',
      nickName: nickName,
      points: 0,
      donateCount: 0
    }
    app.saveUserInfo(userInfo)
    this.setData({
      isLoggedIn: true,
      showProfileSetup: false,
      avatarUrl: '',
      nickName: ''
    })
    this.syncLogin(nickName, userInfo.avatarUrl)
    wx.showToast({ title: '登录成功', icon: 'success' })
  },

  // 跳过资料填写（使用默认身份）
  onSkipProfile() {
    const userInfo = {
      avatarUrl: '',
      nickName: '公益参与者',
      points: 0,
      donateCount: 0
    }
    app.saveUserInfo(userInfo)
    this.setData({
      isLoggedIn: true,
      showProfileSetup: false,
      avatarUrl: '',
      nickName: ''
    })
    this.syncLogin('公益参与者', '')
    wx.showToast({ title: '已使用默认信息', icon: 'none' })
  },

  // 同步登录态到云端（获取并保存 openid 与最新积分）
  syncLogin(nickName, avatarUrl) {
    util.callApi('login', { nickName, avatarUrl })
      .then(res => {
        app.setOpenid(res.openid)
        const userInfo = app.getUserInfo() || {}
        userInfo.points = res.points || 0
        userInfo.donateCount = res.donateCount || 0
        if (nickName) userInfo.nickName = nickName
        if (avatarUrl) userInfo.avatarUrl = avatarUrl
        app.saveUserInfo(userInfo)
      })
      .catch(e => {
        console.warn('云端登录同步失败：', e)
      })
  },

  // 加载物品列表（云端）
  loadItems(reset) {
    if (reset) {
      this.setData({ page: 1, allItems: [], displayItems: [] })
    }
    if (this.data.loading) return

    const { currentCategory, page, pageSize, keyword } = this.data
    this.setData({ loading: true })
    util.callApi('list', { category: currentCategory, page: page, pageSize: pageSize, keyword: keyword })
      .then(res => {
        const newItems = res.list.map(it => this.normalizeItem(it))
        const allItems = this.data.allItems.concat(newItems)
        this.setData({
          allItems: allItems,
          hasMore: res.hasMore,
          loading: false
        })
        this.filterItems()
        this.updateMapMarkers()
      })
      .catch(e => {
        this.setData({ loading: false })
        wx.showToast({ title: typeof e === 'string' ? e : '加载失败', icon: 'none' })
      })
  },

  // 统一处理云端返回的物品字段
  normalizeItem(item) {
    return Object.assign({}, item, {
      id: item._id,
      categoryName: util.getCategoryName(item.category),
      createTimeStr: util.formatTime(new Date(item.createTime).getTime()),
      images: item.images || []
    })
  },

  // 计算统计（云端）
  calculateStats() {
    util.callApi('stats')
      .then(res => {
        this.setData({
          completedCount: res.completedCount,
          availableCount: res.availableCount
        })
      })
      .catch(() => {})
  },

  // 切换分类
  onCategoryChange(e) {
    const category = e.currentTarget.dataset.category
    this.setData({ currentCategory: category })
    this.loadItems(true)
  },

  // 关键词搜索（防抖）
  onSearchInput(e) {
    const keyword = e.detail.value
    this.setData({ keyword })
    clearTimeout(this._searchTimer)
    this._searchTimer = setTimeout(() => {
      this.loadItems(true)
    }, 400)
  },

  // 清空搜索
  clearSearch() {
    clearTimeout(this._searchTimer)
    this.setData({ keyword: '' })
    this.loadItems(true)
  },

  // 客户端分类筛选（云端已按状态筛选，这里仅按分类二次过滤）
  filterItems() {
    const { allItems, currentCategory } = this.data
    let filtered = allItems
    if (currentCategory !== 'all') {
      filtered = allItems.filter(item => item.category === currentCategory)
    }
    this.setData({ displayItems: filtered })
  },

  // 下拉刷新
  onPullDownRefresh() {
    this.loadItems(true)
    this.calculateStats()
    wx.stopPullDownRefresh()
    wx.showToast({ title: '已刷新', icon: 'success', duration: 1000 })
  },

  // 上拉加载更多
  onReachBottom() {
    if (this.data.loading) return
    if (!this.data.hasMore) {
      wx.showToast({ title: '没有更多了', icon: 'none', duration: 1000 })
      return
    }
    this.setData({ page: this.data.page + 1 })
    this.loadItems(false)
  },

  // 切换视图模式
  switchViewMode() {
    const newMode = this.data.viewMode === 'list' ? 'map' : 'list'
    this.setData({ viewMode: newMode })
    if (newMode === 'map') {
      this.updateMapMarkers()
    }
  },

  // 更新地图标记
  updateMapMarkers() {
    const { allItems } = this.data
    const markers = []
    const markerIdMap = {}
    let avgLat = 0, avgLng = 0, count = 0
    let nextId = 1

    allItems.forEach(item => {
      if (item.status === 'available' && item.location && item.location.lat && item.location.lng) {
        const numId = nextId++
        markerIdMap[numId] = item.id
        markers.push({
          id: numId,
          latitude: item.location.lat,
          longitude: item.location.lng,
          title: item.title,
          callout: {
            content: item.title,
            display: 'ALWAYS',
            fontSize: 12,
            padding: 8,
            borderRadius: 4
          },
          iconPath: '/images/marker.png',
          width: 30,
          height: 30
        })
        avgLat += item.location.lat
        avgLng += item.location.lng
        count++
      }
    })

    this.markerIdMap = markerIdMap

    if (count > 0) {
      avgLat /= count
      avgLng /= count
      this.setData({
        mapMarkers: markers,
        mapLat: avgLat,
        mapLng: avgLng
      })
    } else {
      this.setData({ mapMarkers: markers })
    }
  },

  // 地图标记点击
  onMarkerTap(e) {
    const numId = e.detail.markerId
    const itemId = this.markerIdMap[numId]
    if (itemId) {
      wx.navigateTo({
        url: `/pages/detail/detail?id=${itemId}`
      })
    }
  },

  // 点击物品卡片
  onItemTap(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/detail/detail?id=${id}`
    })
  },

  // 查看协议详情
  viewAgreementDetail() {
    wx.showModal({
      title: '公益互助公约',
      content: '1. 本平台仅用于校园内闲置物品的免费流转，禁止任何形式的金钱交易。\n\n2. 请如实描述物品状况，不得发布违禁物品。\n\n3. 物品流转由双方自行协商，本平台仅提供信息展示服务。\n\n4. 发布物品即视为同意无偿赠送给有需要的人。\n\n5. 以物易物需双方自愿协商，不得强制交易。\n\n6. 如发现违规行为，可通过举报功能反馈。',
      showCancel: false,
      confirmText: '我知道了'
    })
  }
})
