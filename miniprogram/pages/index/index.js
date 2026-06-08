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

    // 物品列表
    allItems: [],
    displayItems: [],

    // 分页
    page: 1,
    pageSize: 10,
    hasMore: true,

    // 地图
    mapMarkers: [],
    mapLat: 30.45,
    mapLng: 114.4,
    mapScale: 14,

    // 登录状态
    showAgreement: false,
    isLoggedIn: false
  },

  onLoad() {
    this.checkLogin()
  },

  onShow() {
    this.loadItems()
    this.calculateStats()
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
      // 需要获取用户信息
      this.setData({ isLoggedIn: false })
      return
    }

    this.setData({ isLoggedIn: true })
  },

  // 同意协议
  onAgree() {
    app.setAgreed()
    this.setData({ showAgreement: false })
    // 继续获取用户信息
    this.getUserProfile()
  },

  // 拒绝协议
  onDisagree() {
    wx.showModal({
      title: '提示',
      content: '需要同意《公益互助公约》才能使用小程序',
      showCancel: false,
      confirmText: '我知道了',
      success: () => {
        // 退出小程序（仅模拟）
        this.setData({ showAgreement: true })
      }
    })
  },

  // 获取用户信息
  getUserProfile() {
    wx.getUserProfile({
      desc: '用于展示您的捐赠者信息',
      success: (res) => {
        const userInfo = {
          avatarUrl: res.userInfo.avatarUrl,
          nickName: res.userInfo.nickName,
          points: 0,
          donateCount: 0
        }
        app.saveUserInfo(userInfo)
        this.setData({ isLoggedIn: true })
        wx.showToast({ title: '登录成功', icon: 'success' })
      },
      fail: () => {
        // 获取失败时使用默认用户信息
        const defaultUser = {
          avatarUrl: '',
          nickName: '公益参与者',
          points: 0,
          donateCount: 0
        }
        app.saveUserInfo(defaultUser)
        this.setData({ isLoggedIn: true })
        wx.showToast({ title: '已使用默认信息', icon: 'none' })
      }
    })
  },

  // 加载物品列表
  loadItems() {
    const items = wx.getStorageSync('items') || []
    // 确保每个物品都有 categoryName（向后兼容）
    items.forEach(item => {
      if (!item.categoryName) {
        item.categoryName = util.getCategoryName(item.category)
      }
    })
    // 按发布时间倒序
    items.sort((a, b) => b.createTime - a.createTime)
    this.setData({ allItems: items })
    this.filterItems()
    this.updateMapMarkers()
  },

  // 计算统计数据
  calculateStats() {
    const items = wx.getStorageSync('items') || []
    const completedCount = items.filter(item => item.status === 'completed').length
    const availableCount = items.filter(item => item.status === 'available').length
    this.setData({ completedCount, availableCount })
  },

  // 切换分类
  onCategoryChange(e) {
    const category = e.currentTarget.dataset.category
    this.setData({
      currentCategory: category,
      page: 1,
      displayItems: []
    })
    this.filterItems()
  },

  // 筛选物品
  filterItems() {
    const { allItems, currentCategory, page, pageSize } = this.data
    let filtered = allItems

    // 按分类筛选
    if (currentCategory !== 'all') {
      filtered = allItems.filter(item => item.category === currentCategory)
    }

    // 只显示可用的物品
    filtered = filtered.filter(item => item.status === 'available')

    // 分页
    const start = 0
    const end = page * pageSize
    const displayItems = filtered.slice(start, end)
    const hasMore = end < filtered.length

    this.setData({ displayItems, hasMore })
  },

  // 下拉刷新
  onPullDownRefresh() {
    this.setData({ page: 1 })
    this.loadItems()
    this.calculateStats()
    wx.stopPullDownRefresh()
    wx.showToast({ title: '已刷新', icon: 'success', duration: 1000 })
  },

  // 上拉加载更多
  onReachBottom() {
    if (!this.data.hasMore) {
      wx.showToast({ title: '没有更多了', icon: 'none', duration: 1000 })
      return
    }
    this.setData({ page: this.data.page + 1 })
    this.filterItems()
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
    const markerIdMap = {} // 数字 id -> 物品 id 映射
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
