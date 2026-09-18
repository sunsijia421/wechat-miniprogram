const util = require('../../utils/util')

Page({
  data: {
    isAdmin: false,
    checked: false,
    loading: true,
    activeTab: 'overview', // overview | items | users | reports

    // 数据总览
    stats: null,
    statCards: [],

    // 物品管理
    items: [],
    itemPage: 1,
    itemTotal: 0,
    itemHasMore: true,
    itemKeyword: '',
    itemStatusFilter: '', // '' | available | offline | completed

    // 用户管理
    users: [],
    userPage: 1,
    userTotal: 0,
    userHasMore: true,
    userKeyword: '',

    // 举报管理
    reports: [],
    reportPage: 1,
    reportHasMore: true
  },

  onShow() {
    this.checkAndLoad()
  },

  onPullDownRefresh() {
    this.refreshCurrentTab()
    wx.stopPullDownRefresh()
  },

  // 校验管理员身份并加载当前 Tab
  checkAndLoad() {
    util.callApi('isAdmin')
      .then(res => {
        this.setData({ isAdmin: res.isAdmin, checked: true })
        if (res.isAdmin) {
          this.refreshCurrentTab()
        } else {
          this.setData({ loading: false })
        }
      })
      .catch(() => {
        this.setData({ checked: true, isAdmin: false, loading: false })
      })
  },

  refreshCurrentTab() {
    const tab = this.data.activeTab
    if (tab === 'overview') this.loadStats()
    else if (tab === 'items') this.loadItems(true)
    else if (tab === 'users') this.loadUsers(true)
    else if (tab === 'reports') this.loadReports(true)
  },

  // 切换 Tab
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (tab === this.data.activeTab) return
    this.setData({ activeTab: tab, loading: true })
    this.refreshCurrentTab()
  },

  // ========== 数据总览 ==========
  loadStats() {
    util.callApi('adminStats')
      .then(res => {
        const s = res.stats
        this.setData({
          stats: s,
          loading: false,
          statCards: [
            { label: '注册用户', value: s.userCount, icon: '👥' },
            { label: '物品总数', value: s.itemCount, icon: '📦' },
            { label: '可领取', value: s.availableCount, icon: '🟢' },
            { label: '已送出', value: s.completedCount, icon: '✅' },
            { label: '已下架', value: s.offlineCount, icon: '📴' },
            { label: '申请记录', value: s.applicationCount, icon: '📋' },
            { label: '举报总数', value: s.reportCount, icon: '🚨' },
            { label: '待处理举报', value: s.pendingReportCount, icon: '⏳' },
            { label: '已封禁用户', value: s.bannedCount, icon: '🔒' }
          ]
        })
      })
      .catch(e => {
        this.setData({ loading: false })
        wx.showToast({ title: typeof e === 'string' ? e : '加载失败', icon: 'none' })
      })
  },

  // ========== 物品管理 ==========
  loadItems(reset) {
    if (this.data.loading) return
    if (reset) this.setData({ itemPage: 1, items: [] })
    const { itemPage, itemKeyword, itemStatusFilter } = this.data
    this.setData({ loading: true })
    util.callApi('adminItems', {
      page: itemPage,
      pageSize: 20,
      status: itemStatusFilter,
      keyword: itemKeyword
    })
      .then(res => {
        const list = res.list.map(it => this.normalizeAdminItem(it))
        const items = this.data.items.concat(list)
        this.setData({
          items,
          itemTotal: res.total,
          itemHasMore: res.hasMore,
          loading: false
        })
      })
      .catch(e => {
        this.setData({ loading: false })
        wx.showToast({ title: typeof e === 'string' ? e : '加载失败', icon: 'none' })
      })
  },

  normalizeAdminItem(it) {
    return Object.assign({}, it, {
      id: it._id,
      categoryName: util.getCategoryName(it.category),
      createTimeStr: util.formatTime(it.createTime),
      statusText: it.status === 'completed' ? '已送出' : it.status === 'offline' ? '已下架' : '可领取',
      statusClass: it.status === 'completed' ? 'completed' : it.status === 'offline' ? 'offline' : 'available'
    })
  },

  onItemKeywordInput(e) {
    this.setData({ itemKeyword: e.detail.value })
  },
  searchItems() {
    this.loadItems(true)
  },
  clearItemKeyword() {
    this.setData({ itemKeyword: '' })
    this.loadItems(true)
  },
  setItemStatusFilter(e) {
    const status = e.currentTarget.dataset.status
    this.setData({ itemStatusFilter: status })
    this.loadItems(true)
  },

  // 管理员下架/上架
  adminToggleItem(e) {
    const id = e.currentTarget.dataset.id
    const status = e.currentTarget.dataset.status
    const target = status === 'available' ? 'offline' : 'available'
    const that = this
    wx.showModal({
      title: target === 'offline' ? '下架物品' : '重新上架',
      content: target === 'offline' ? '确认下架该物品吗？下架后从公开列表隐藏。' : '确认将该物品重新上架吗？',
      confirmText: target === 'offline' ? '确认下架' : '确认上架',
      success: function (r) {
        if (!r.confirm) return
        util.callApi('adminSetItemStatus', { id, status: target })
          .then(() => {
            wx.showToast({ title: '操作成功', icon: 'success' })
            that.loadItems(true)
          })
          .catch(err => {
            wx.showToast({ title: typeof err === 'string' ? err : '操作失败', icon: 'none' })
          })
      }
    })
  },

  // 管理员删除物品
  adminDeleteItem(e) {
    const id = e.currentTarget.dataset.id
    const that = this
    wx.showModal({
      title: '删除物品',
      content: '确认删除该物品吗？相关申请、举报、收藏、会话将一并清除。',
      confirmText: '删除',
      confirmColor: '#f44336',
      success: function (r) {
        if (!r.confirm) return
        util.callApi('adminDeleteItem', { id })
          .then(() => {
            wx.showToast({ title: '已删除', icon: 'success' })
            that.loadItems(true)
          })
          .catch(err => {
            wx.showToast({ title: typeof err === 'string' ? err : '删除失败', icon: 'none' })
          })
      }
    })
  },

  // 物品列表触底加载
  loadMoreItems() {
    if (!this.data.itemHasMore || this.data.loading) return
    this.setData({ itemPage: this.data.itemPage + 1 })
    this.loadItems(false)
  },

  // ========== 用户管理 ==========
  loadUsers(reset) {
    if (this.data.loading) return
    if (reset) this.setData({ userPage: 1, users: [] })
    const { userPage, userKeyword } = this.data
    this.setData({ loading: true })
    util.callApi('adminUsers', { page: userPage, pageSize: 20, keyword: userKeyword })
      .then(res => {
        const users = this.data.users.concat(res.list)
        this.setData({
          users,
          userTotal: res.total,
          userHasMore: res.hasMore,
          loading: false
        })
      })
      .catch(e => {
        this.setData({ loading: false })
        wx.showToast({ title: typeof e === 'string' ? e : '加载失败', icon: 'none' })
      })
  },

  onUserKeywordInput(e) {
    this.setData({ userKeyword: e.detail.value })
  },
  searchUsers() {
    this.loadUsers(true)
  },
  clearUserKeyword() {
    this.setData({ userKeyword: '' })
    this.loadUsers(true)
  },

  // 封禁/解封
  adminBanUser(e) {
    const userId = e.currentTarget.dataset.id
    const banned = e.currentTarget.dataset.banned === 'true'
    const that = this
    wx.showModal({
      title: banned ? '解封用户' : '封禁用户',
      content: banned
        ? '确认解封该用户吗？解封后可正常发布、申请、举报。'
        : '确认封禁该用户吗？封禁后仅可浏览，不能发布/申请/举报。',
      confirmText: banned ? '解封' : '封禁',
      confirmColor: banned ? '#4CAF50' : '#f44336',
      success: function (r) {
        if (!r.confirm) return
        util.callApi('adminBanUser', { userId, ban: !banned })
          .then(() => {
            wx.showToast({ title: banned ? '已解封' : '已封禁', icon: 'success' })
            that.loadUsers(true)
          })
          .catch(err => {
            wx.showToast({ title: typeof err === 'string' ? err : '操作失败', icon: 'none' })
          })
      }
    })
  },

  // 用户列表触底加载
  loadMoreUsers() {
    if (!this.data.userHasMore || this.data.loading) return
    this.setData({ userPage: this.data.userPage + 1 })
    this.loadUsers(false)
  },

  // ========== 举报管理 ==========
  loadReports(reset) {
    if (this.data.loading) return
    if (reset) this.setData({ reportPage: 1, reports: [] })
    this.setData({ loading: true })
    util.callApi('adminReports', {})
      .then(res => {
        const list = res.list.map(r => this.normalizeReport(r))
        this.setData({ reports: list, loading: false })
      })
      .catch(e => {
        this.setData({ loading: false })
        wx.showToast({ title: typeof e === 'string' ? e : '加载失败', icon: 'none' })
      })
  },

  normalizeReport(r) {
    return Object.assign({}, r, {
      id: r._id,
      createTimeStr: util.formatTime(r.createTime),
      statusText: r.status === 'handled'
        ? (r.result === 'offline' ? '已下架' : '已忽略')
        : '待处理',
      itemStatusText: r.itemStatus === 'offline' ? '已下架'
        : r.itemStatus === 'completed' ? '已送出'
        : r.itemStatus === 'deleted' ? '已删除' : '可领取'
    })
  },

  // 跳转物品详情
  goDetail(e) {
    const itemId = e.currentTarget.dataset.itemid
    if (!itemId) return
    wx.navigateTo({ url: '/pages/detail/detail?id=' + itemId })
  },

  // 处理举报：offline=下架物品；ignore=忽略单条
  handleReport(e) {
    const action = e.currentTarget.dataset.action
    const itemId = e.currentTarget.dataset.itemid
    const reportId = e.currentTarget.dataset.id
    const isOffline = action === 'offline'
    const that = this
    wx.showModal({
      title: isOffline ? '下架该物品' : '忽略举报',
      content: isOffline
        ? '确认下架该物品吗？下架后将从公开列表隐藏。'
        : '确认忽略该举报（认为物品合规）吗？',
      confirmText: isOffline ? '确认下架' : '确认忽略',
      confirmColor: isOffline ? '#f44336' : '#4CAF50',
      cancelText: '取消',
      success: function (res) {
        if (!res.confirm) return
        util.callApi('handleReport', { itemId: itemId, reportId: reportId, action: action })
          .then(() => {
            that.loadReports(true)
            wx.showToast({ title: isOffline ? '物品已下架' : '已忽略', icon: 'success' })
          })
          .catch(e => {
            wx.showToast({ title: typeof e === 'string' ? e : '操作失败', icon: 'none' })
          })
      }
    })
  },

  goBack() {
    wx.navigateBack()
  },

  // 返回用户端（切回首页）
  backToUser() {
    wx.switchTab({ url: '/pages/index/index' })
  }
})
