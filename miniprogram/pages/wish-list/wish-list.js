// 心愿求购（P6 亮点：需求侧发帖，与闲置双向匹配）
const util = require('../../utils/util')

Page({
  data: {
    categories: util.CATEGORY_LIST,
    categoryKeys: util.CATEGORY_KEYS,
    currentCategory: 'all',
    tab: 'all', // all | mine
    list: [],
    mine: [],
    page: 1,
    pageSize: 10,
    hasMore: true,
    loading: false,
    isEmpty: false,
    isLoggedIn: false
  },

  onShow() {
    this.setData({ isLoggedIn: !!wx.getStorageSync('userInfo') })
    this.loadList(true)
    if (this.data.isLoggedIn) this.loadMine()
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (tab === this.data.tab) return
    this.setData({ tab })
    if (tab === 'all') this.loadList(true)
    if (tab === 'mine') this.loadMine()
  },

  onCategoryChange(e) {
    const idx = e.currentTarget.dataset.index
    const key = this.data.categoryKeys[idx]
    if (key === this.data.currentCategory) return
    this.setData({ currentCategory: key })
    this.loadList(true)
  },

  // 全部求购列表
  loadList(isRefresh) {
    if (this.data.loading) return
    const page = isRefresh ? 1 : this.data.page
    this.setData({ loading: true })
    util.callApi('wishList', {
      category: this.data.currentCategory,
      page,
      pageSize: this.data.pageSize
    })
      .then(res => {
        const list = (res.list || []).map(w => Object.assign({}, w, {
          id: w._id,
          categoryName: util.getCategoryName(w.category),
          createTimeStr: util.formatTime(w.createTime),
          descShort: w.description.length > 40 ? w.description.slice(0, 40) + '...' : w.description
        }))
        this.setData({
          list: isRefresh ? list : this.data.list.concat(list),
          hasMore: !!res.hasMore,
          page: page + 1,
          loading: false,
          isEmpty: isRefresh && list.length === 0
        })
      })
      .catch(e => {
        this.setData({ loading: false })
        wx.showToast({ title: typeof e === 'string' ? e : '加载失败', icon: 'none' })
      })
  },

  onReachBottom() {
    if (this.data.tab === 'all' && this.data.hasMore) this.loadList(false)
  },

  onPullDownRefresh() {
    if (this.data.tab === 'all') {
      this.loadList(true)
    } else {
      this.loadMine()
    }
    setTimeout(() => wx.stopPullDownRefresh(), 600)
  },

  // 我的求购
  loadMine() {
    util.callApi('myWishes', {})
      .then(res => {
        const mine = (res.list || []).map(w => Object.assign({}, w, {
          categoryName: util.getCategoryName(w.category),
          createTimeStr: util.formatTime(w.createTime),
          statusText: w.status === 'open' ? '进行中' : '已满足',
          statusClass: w.status === 'open' ? 'open' : 'done'
        }))
        this.setData({ mine })
      })
      .catch(() => {})
  },

  // 关闭求购（已满足）
  closeWish(e) {
    const id = e.currentTarget.dataset.id
    const that = this
    wx.showModal({
      title: '标记为已满足',
      content: '确认该求购已得到满足吗？标记后将从公开列表移除。',
      confirmText: '确认',
      cancelText: '取消',
      success(res) {
        if (!res.confirm) return
        util.callApi('closeWish', { id })
          .then(() => {
            wx.showToast({ title: '已标记为满足', icon: 'success' })
            that.loadMine()
          })
          .catch(err => wx.showToast({ title: typeof err === 'string' ? err : '操作失败', icon: 'none' }))
      }
    })
  },

  // 查看详情
  openDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/wish-detail/wish-detail?id=' + id })
  },

  // 发布求购
  goPublish() {
    if (!util.requireLogin()) return
    wx.navigateTo({ url: '/pages/wish-publish/wish-publish' })
  }
})
