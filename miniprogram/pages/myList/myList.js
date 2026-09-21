const util = require('../../utils/util')

// 通用"我的"列表页：published(我发布的) / applied(我申请的) / favorites(我收藏的) / reported(我举报的)
const TYPE_CONFIG = {
  published: { title: '我发布的', api: 'myPublish', empty: '还没有发布过物品', emptySub: '点击底部"发布"分享闲置好物吧~' },
  applied: { title: '我申请的', api: 'myApply', empty: '还没有申请过物品', emptySub: '看到需要的物品就去申请领取吧~' },
  favorites: { title: '我收藏的', api: 'myFavorites', empty: '还没有收藏物品', emptySub: '遇到心仪的物品点击爱心收藏~' },
  reported: { title: '我举报的', api: 'myReports', empty: '还没有提交过举报', emptySub: '发现违规物品可点击举报~' }
}

Page({
  data: {
    type: 'published',
    cfg: TYPE_CONFIG.published,
    list: [],
    loading: false
  },

  onLoad(options) {
    const type = options.type && TYPE_CONFIG[options.type] ? options.type : 'published'
    this.setData({ type, cfg: TYPE_CONFIG[type] })
    wx.setNavigationBarTitle({ title: TYPE_CONFIG[type].title })
    this.loadList()
  },

  onPullDownRefresh() {
    this.loadList(true)
  },

  loadList(isRefresh) {
    if (this.data.loading && !isRefresh) return
    this.setData({ loading: true })
    const cfg = this.data.cfg
    util.callApi(cfg.api, {})
      .then(res => {
        this.setData({ list: this.normalize(res.list || []), loading: false })
      })
      .catch(e => {
        this.setData({ loading: false })
        wx.showToast({ title: typeof e === 'string' ? e : '加载失败', icon: 'none' })
      })
      .then(() => wx.stopPullDownRefresh())
  },

  // 按类型归一化列表字段
  normalize(list) {
    if (this.data.type === 'reported') {
      return list.map(r => ({
        id: r._id,
        itemId: r.itemId,
        itemTitle: r.itemTitle || '(物品已删除)',
        reason: r.reason || '',
        createTimeStr: util.formatTime(r.createTime),
        statusText: r.status === 'handled'
          ? (r.result === 'offline' ? '已下架' : '已忽略')
          : '待处理',
        statusClass: r.status === 'handled' ? 'handled' : 'pending'
      }))
    }
    const isFav = this.data.type === 'favorites'
    return list.map(it => ({
      id: isFav ? it.itemId || it.id : (it._id || it.id),
      title: isFav ? it.itemTitle : it.title,
      image: isFav ? it.itemImage : (it.images && it.images[0]),
      categoryName: util.getCategoryName(it.category),
      statusText: it.status === 'completed' ? '已送出' : it.status === 'offline' ? '已下架' : it.status === 'waiting_confirm' ? '待确认收到' : '可领取',
      statusClass: it.status === 'completed' ? 'completed' : it.status === 'offline' ? 'offline' : it.status === 'waiting_confirm' ? 'pending' : 'available',
      applyStatus: it.applyStatus,
      applyText: it.applyStatus === 'pending' ? '申请中'
        : it.applyStatus === 'approved' ? (it.status === 'waiting_confirm' ? '待我确认收到' : '已通过')
        : it.applyStatus === 'confirmed' ? '已完成'
        : it.applyStatus === 'missed' ? '超时未确认'
        : '未选中',
      applyClass: it.applyStatus === 'missed' ? 'missed'
        : it.applyStatus === 'approved' && it.status === 'waiting_confirm' ? 'waiting'
        : it.applyStatus === 'confirmed' ? 'confirmed'
        : it.applyStatus === 'pending' ? 'pending' : 'rejected'
    }))
  },

  onItemTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
  }
})
