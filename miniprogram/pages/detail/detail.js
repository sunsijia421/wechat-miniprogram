const app = getApp()
const util = require('../../utils/util')

Page({
  data: {
    itemId: '',
    item: null,
    isOwner: false,
    isCompleted: false,
    // P7：待确认状态（发布者已送出，等待申请者确认收到）
    isWaitingConfirm: false,
    // P7：置顶中
    topUntil: '',

    // 申请相关
    applications: [],
    showApplyModal: false,
    applyMessage: '',

    // 举报相关
    showReportModal: false,
    reportReason: '',
    reportTarget: 'item', // item=举报物品 user=举报用户

    // 当前用户（已登录才有值，游客为 null）
    currentUser: null,

    // 登录态（游客只能浏览，不能申请/交换/举报）
    isLoggedIn: false,

    // 已下架（offline）状态
    isOffline: false,

    // 该物品的举报记录（仅发布者可见）
    reports: [],

    // P0 新增：收藏 / 关注 / 会话
    favorited: false,
    followed: false,
    hasConversation: false,

    // 已申请状态（申请后按钮置灰显示"已申请"）
    hasApplied: false,
    applyStatus: '',
    myApplicationId: '',

    // P2：猜你喜欢
    relatedItems: [],

    // P5：完成互评
    evaluated: false,
    showEvalModal: false,
    evalRating: 0,
    evalComment: '',
    submittingEval: false
  },

  onLoad(options) {
    const itemId = options.id
    if (!itemId) {
      wx.showToast({ title: '物品不存在', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
      return
    }
    this.setData({ itemId, isLoggedIn: !!app.getUserInfo() })
    this.loadItem()
  },

  onShow() {
    // 登录态可能在本页停留期间发生变化（如从首页登录后返回）
    this.setData({ isLoggedIn: !!app.getUserInfo() })
    if (this.data.itemId) {
      this.loadItem()
    }
  },

  // 统一处理云端返回的物品字段
  normalizeItem(item) {
    return Object.assign({}, item, {
      id: item._id,
      categoryName: util.getCategoryName(item.category),
      createTimeStr: util.formatTime(item.createTime)
    })
  },

  // 统一处理举报记录字段
  normalizeReport(r) {
    return Object.assign({}, r, {
      id: r._id,
      createTimeStr: util.formatTime(r.createTime)
    })
  },

  // 将云存储 fileID 转为临时 URL（供 image 组件与预览使用）
  getTempUrls(fileIDs) {
    if (!fileIDs || !fileIDs.length) return Promise.resolve([])
    return new Promise((resolve) => {
      wx.cloud.getTempFileURL({
        fileList: fileIDs,
        success: res => {
          const urls = (res.fileList || []).map(f => f.tempFileURL || f.fileID)
          resolve(urls)
        },
        fail: () => resolve(fileIDs)
      })
    })
  },

  // ========== 物品加载 ==========
  async loadItem() {
    try {
      const res = await util.callApi('detail', { id: this.data.itemId })
      const item = this.normalizeItem(res.item)
      item.images = await this.getTempUrls(item.images)
      const reports = (res.reports || []).map(r => this.normalizeReport(r))
      // P2：猜你喜欢（同分类推荐，无需转临时 URL，缩略图直接用 fileID 即可由 image 组件解析）
      const relatedItems = (res.related || []).map(r => this.normalizeItem(r))
      this.setData({
        item,
        isOwner: res.isOwner,
        isCompleted: item.status === 'completed',
        isWaitingConfirm: item.status === 'waiting_confirm',
        isOffline: item.status === 'offline',
        topUntil: item.topUntil ? util.formatTime(item.topUntil) : '',
        currentUser: app.getUserInfo() || null,
        reports,
        hasApplied: !!res.hasApplied,
        applyStatus: res.applyStatus || '',
        myApplicationId: res.applyId || '',
        relatedItems
      })
      if (res.isOwner) this.loadApplications()
      // P0：加载收藏/关注状态（登录且非本人发布时）
      if (app.getUserInfo() && !res.isOwner) {
        this.loadFavoriteStatus()
        this.loadFollowStatus()
      }
      // P5：已完成物品加载评价状态（本人参与方）
      if (app.getUserInfo() && item.status === 'completed') {
        this.loadEvaluationStatus()
      }
    } catch (e) {
      wx.showToast({ title: typeof e === 'string' ? e : '加载失败', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
    }
  },

  // ========== 申请记录加载（仅发布者；P7：按积分降序，展示积分/等级） ==========
  loadApplications() {
    util.callApi('applications', { itemId: this.data.itemId })
      .then(res => {
        const list = res.list.map(a => Object.assign({}, a, {
          applicantName: a.applicantNickName || '匿名',
          applicantAvatar: a.applicantAvatarUrl || '',
          createTimeStr: util.formatTime(a.createTime)
        }))
        this.setData({ applications: list })
      })
      .catch(() => {})
  },

  // P2：点击猜你喜欢物品跳转详情
  onItemTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
  },

  // ========== 图片预览 ==========
  previewImage(e) {
    const index = e.currentTarget.dataset.index
    const urls = this.data.item ? this.data.item.images : []
    wx.previewImage({ current: urls[index], urls })
  },

  // ========== 申请流程 ==========
  openApply() {
    // 游客只能浏览，必须先登录才能申请/交换
    if (!util.requireLogin()) return
    this.setData({ showApplyModal: true, applyMessage: '' })
  },

  // 游客点击申请/交换占位按钮：跳首页引导登录
  goLogin() {
    wx.switchTab({ url: '/pages/index/index' })
  },

  closeApply() {
    this.setData({ showApplyModal: false, applyMessage: '' })
  },

  onApplyMessageInput(e) {
    this.setData({ applyMessage: e.detail.value })
  },

  submitApply() {
    if (!util.requireLogin()) return
    const message = this.data.applyMessage.trim()
    if (!message) {
      wx.showToast({ title: '请填写申请留言', icon: 'none' })
      return
    }

    const textCheck = util.checkTextContent(message)
    if (!textCheck.passed) {
      wx.showToast({ title: '留言包含敏感词，请修改', icon: 'none' })
      return
    }

    // P0：先请求订阅授权（申请结果通知），授权失败不影响提交
    const that = this
    util.requestSubscribe('applyResult').then(() => {
      that.doSubmitApply(message)
    }, () => {
      that.doSubmitApply(message)
    })
  },

  // 提交申请（订阅授权后执行）
  doSubmitApply(message) {
    const that = this
    const userInfo = app.getUserInfo() || {}
    const item = that.data.item
    util.callApi('apply', {
      itemId: that.data.itemId,
      message: message,
      itemTitle: item.title,
      applicantNickName: userInfo.nickName || '公益参与者',
      applicantAvatarUrl: userInfo.avatarUrl || ''
    })
      .then(() => {
        // 申请成功后立即置为"已申请"，按钮变为置灰状态
        that.setData({ showApplyModal: false, applyMessage: '', hasApplied: true, applyStatus: 'pending' })
        that.loadApplications()
        wx.showToast({ title: '申请已提交', icon: 'success' })
      })
      .catch(e => {
        wx.showToast({ title: typeof e === 'string' ? e : '提交失败', icon: 'none' })
      })
  },

  // ========== 发布者确认送出（P7：进入"待确认"状态，对方确认收到后才结算） ==========
  approveApplication(e) {
    const applicationId = e.currentTarget.dataset.id
    const that = this
    wx.showModal({
      title: '确认送出',
      content: '确认将物品送给这位申请者吗？确认后等待对方"确认收到"，对方确认后才结算积分与证书；对方3天内未确认将自动重新上架。',
      confirmText: '确认送出',
      cancelText: '再想想',
      success: function (res) {
        if (res.confirm) {
          that.doCompleteItem(applicationId)
        }
      }
    })
  },

  confirmComplete() {
    const that = this
    wx.showModal({
      title: '确认已送出',
      content: '确认该物品已成功送出吗？确认后等待对方"确认收到"，对方确认后才结算积分。',
      confirmText: '确认',
      cancelText: '取消',
      success: function (res) {
        if (res.confirm) {
          that.doCompleteItem(null)
        }
      }
    })
  },

  // ========== 完成捐赠核心逻辑 ==========
  doCompleteItem(applicationId) {
    util.callApi('handleApply', {
      itemId: this.data.itemId,
      applicationId: applicationId || '',
      action: applicationId ? 'approve' : 'complete'
    })
      .then(() => {
        this.loadItem()
        wx.showToast({ title: '已送出，等待对方确认', icon: 'success' })
      })
      .catch(e => {
        wx.showToast({ title: typeof e === 'string' ? e : '操作失败', icon: 'none' })
      })
  },

  // ========== P7：申请者确认收到（结算积分/证书/互评） ==========
  confirmReceive(e) {
    const applicationId = e.currentTarget.dataset.id
    if (!applicationId) {
      wx.showToast({ title: '参数缺失', icon: 'none' })
      return
    }
    const that = this
    wx.showModal({
      title: '确认收到',
      content: '确认已收到该物品吗？确认后本次赠送完成，双方获得积分，发布者生成公益证书。',
      confirmText: '确认收到',
      cancelText: '暂不确认',
      success: function (res) {
        if (!res.confirm) return
        util.callApi('confirmReceive', {
          itemId: that.data.itemId,
          applicationId: applicationId
        })
          .then(() => {
            app.updateUserStats(5, 0)
            that.loadItem()
            wx.showToast({ title: '已确认，公益+5分', icon: 'success' })
          })
          .catch(err => {
            wx.showToast({ title: typeof err === 'string' ? err : '操作失败', icon: 'none' })
          })
      }
    })
  },

  // ========== P7：物品置顶 24 小时（20 积分） ==========
  topItem() {
    const that = this
    wx.showModal({
      title: '置顶物品',
      content: '花费20积分将物品置顶24小时（列表置前展示），让更多人看到它。',
      confirmText: '置顶',
      cancelText: '取消',
      success: function (res) {
        if (!res.confirm) return
        util.callApi('topItem', { itemId: that.data.itemId })
          .then(r => {
            that.loadItem()
            wx.showToast({ title: '已置顶24小时', icon: 'success' })
          })
          .catch(err => {
            wx.showToast({ title: typeof err === 'string' ? err : '置顶失败', icon: 'none' })
          })
      }
    })
  },

  // ========== 删除物品（仅发布者） ==========
  deleteItem() {
    const that = this
    wx.showModal({
      title: '删除物品',
      content: '确定要删除该物品吗？删除后不可恢复，相关申请与举报记录也会一并清除。',
      confirmText: '删除',
      confirmColor: '#f44336',
      success: function (res) {
        if (!res.confirm) return
        util.callApi('delete', { id: that.data.itemId })
          .then(() => {
            wx.showToast({ title: '已删除', icon: 'success' })
            setTimeout(() => wx.navigateBack(), 1000)
          })
          .catch(e => {
            wx.showToast({ title: typeof e === 'string' ? e : '删除失败', icon: 'none' })
          })
      }
    })
  },

  // ========== 编辑 / 下架（仅发布者） ==========
  goEdit() {
    wx.navigateTo({
      url: '/pages/edit/edit?id=' + this.data.itemId
    })
  },

  toggleOffline() {
    const that = this
    const isOffline = this.data.isOffline
    wx.showModal({
      title: isOffline ? '重新上架' : '下架物品',
      content: isOffline
        ? '确认将该物品重新上架（公开可见）吗？'
        : '确认下架该物品吗？下架后将从公开列表隐藏，可在详情页重新上架。',
      confirmText: isOffline ? '重新上架' : '确认下架',
      confirmColor: isOffline ? '#4CAF50' : '#f44336',
      cancelText: '取消',
      success: function (res) {
        if (!res.confirm) return
        util.callApi('setStatus', {
          id: that.data.itemId,
          status: isOffline ? 'available' : 'offline'
        })
          .then(() => {
            that.loadItem()
            wx.showToast({ title: isOffline ? '已重新上架' : '已下架', icon: 'success' })
          })
          .catch(e => {
            wx.showToast({ title: typeof e === 'string' ? e : '操作失败', icon: 'none' })
          })
      }
    })
  },

  // ========== 举报处理（发布者自见，可下架/忽略） ==========
  handleReport(e) {
    const action = e.currentTarget.dataset.action
    const reportId = e.currentTarget.dataset.id || ''
    const that = this
    const isOffline = action === 'offline'
    wx.showModal({
      title: isOffline ? '下架该物品' : '忽略举报',
      content: isOffline
        ? '确认因该举报下架此物品吗？下架后将不在公开列表展示。'
        : '确认忽略该举报（认为物品合规）吗？',
      confirmText: isOffline ? '确认下架' : '确认忽略',
      confirmColor: isOffline ? '#f44336' : '#4CAF50',
      cancelText: '取消',
      success: function (res) {
        if (!res.confirm) return
        util.callApi('handleReport', {
          itemId: that.data.itemId,
          reportId: reportId,
          action: action
        })
          .then(() => {
            that.loadItem()
            wx.showToast({ title: isOffline ? '物品已下架' : '已忽略', icon: 'success' })
          })
          .catch(e => {
            wx.showToast({ title: typeof e === 'string' ? e : '操作失败', icon: 'none' })
          })
      }
    })
  },

  // ========== P0：收藏 / 关注 / 消息 ==========

  loadFavoriteStatus() {
    if (!this.data.itemId) return
    util.callApi('favoriteStatus', { itemId: this.data.itemId })
      .then(res => this.setData({ favorited: !!res.favorited }))
      .catch(() => {})
  },

  loadFollowStatus() {
    if (!this.data.item || !this.data.item._openid) return
    util.callApi('followStatus', { targetOpenid: this.data.item._openid })
      .then(res => this.setData({ followed: !!res.followed }))
      .catch(() => {})
  },

  // 切换收藏
  toggleFavorite() {
    if (!util.requireLogin()) return
    util.callApi('toggleFavorite', { itemId: this.data.itemId })
      .then(res => {
        this.setData({ favorited: !!res.favorited })
        wx.showToast({ title: res.favorited ? '已收藏 ❤️' : '已取消收藏', icon: 'none' })
      })
      .catch(e => {
        wx.showToast({ title: typeof e === 'string' ? e : '操作失败', icon: 'none' })
      })
  },

  // 切换关注
  toggleFollow() {
    if (!util.requireLogin()) return
    if (!this.data.item || !this.data.item._openid) return
    util.callApi('toggleFollow', { targetOpenid: this.data.item._openid })
      .then(res => {
        this.setData({ followed: !!res.followed })
        wx.showToast({ title: res.followed ? '已关注发布者' : '已取消关注', icon: 'none' })
      })
      .catch(e => {
        wx.showToast({ title: typeof e === 'string' ? e : '操作失败', icon: 'none' })
      })
  },

  // 打开与发布者的会话（申请后自动创建；若没有会话则提示先申请）
  openConversation() {
    if (!util.requireLogin()) return
    // 通过 myConversations 查找与当前物品、当前发布者的会话
    util.callApi('myConversations', {})
      .then(res => {
        const conv = res.list.find(c => c.itemId === this.data.itemId)
        if (conv) {
          wx.navigateTo({ url: '/pages/chat/chat?convId=' + conv.id })
        } else {
          wx.showToast({ title: '先提交申请，即可与发布者沟通', icon: 'none' })
        }
      })
      .catch(() => {
        wx.showToast({ title: '操作失败', icon: 'none' })
      })
  },

  // ========== P5：完成互评 ==========

  // 加载我是否已评价该物品
  loadEvaluationStatus() {
    util.callApi('evaluationStatus', { itemId: this.data.itemId })
      .then(res => this.setData({ evaluated: !!res.evaluated }))
      .catch(() => {})
  },

  // 打开评价弹窗
  openEval() {
    if (!util.requireLogin()) return
    this.setData({ showEvalModal: true, evalRating: 0, evalComment: '' })
  },

  closeEval() {
    this.setData({ showEvalModal: false })
  },

  onEvalRating(e) {
    this.setData({ evalRating: Number(e.currentTarget.dataset.star) })
  },

  onEvalComment(e) {
    this.setData({ evalComment: e.detail.value })
  },

  // 提交评价
  submitEvaluation() {
    const rating = this.data.evalRating
    if (!rating) {
      wx.showToast({ title: '请选择评分', icon: 'none' })
      return
    }
    if (this.data.submittingEval) return
    this.setData({ submittingEval: true })
    util.callApi('submitEvaluation', {
      itemId: this.data.itemId,
      rating,
      comment: this.data.evalComment.trim()
    })
      .then(res => {
        this.setData({ showEvalModal: false, evaluated: true, submittingEval: false })
        wx.showToast({ title: '评价成功，感谢反馈！', icon: 'success' })
      })
      .catch(e => {
        this.setData({ submittingEval: false })
        wx.showToast({ title: typeof e === 'string' ? e : '评价失败', icon: 'none' })
      })
  },

  // ========== 举报流程 ==========
  openReport() {
    // 游客只能浏览，举报需先登录（避免匿名滥用）
    if (!util.requireLogin()) return
    this.setData({ showReportModal: true, reportReason: '' })
  },

  closeReport() {
    this.setData({ showReportModal: false, reportReason: '', reportTarget: 'item' })
  },

  onReportReasonInput(e) {
    this.setData({ reportReason: e.detail.value })
  },

  submitReport() {
    if (!util.requireLogin()) return
    const reason = this.data.reportReason.trim()
    if (!reason) {
      wx.showToast({ title: '请填写举报理由', icon: 'none' })
      return
    }

    const textCheck = util.checkTextContent(reason)
    if (!textCheck.passed) {
      wx.showToast({ title: '举报理由包含敏感词', icon: 'none' })
      return
    }

    util.callApi('report', {
      itemId: this.data.itemId,
      itemTitle: this.data.item ? this.data.item.title : '',
      reason: reason
    })
      .then(() => {
        this.setData({ showReportModal: false, reportReason: '' })
        wx.showToast({ title: '已收到举报，我们会尽快处理', icon: 'none' })
        // P0：请求订阅授权（举报处理结果通知），授权失败不影响举报
        util.requestSubscribe('reportResult').then(() => {}, () => {})
      })
      .catch(e => {
        wx.showToast({ title: typeof e === 'string' ? e : '提交失败', icon: 'none' })
      })
  },

  // ========== P7：举报用户（发布者违规/骚扰） ==========
  openReportUser() {
    if (!util.requireLogin()) return
    this.setData({ showReportModal: true, reportReason: '', reportTarget: 'user' })
  },

  submitReportUser() {
    if (!util.requireLogin()) return
    const reason = this.data.reportReason.trim()
    if (!reason) {
      wx.showToast({ title: '请填写举报理由', icon: 'none' })
      return
    }
    const textCheck = util.checkTextContent(reason)
    if (!textCheck.passed) {
      wx.showToast({ title: '举报理由包含敏感词', icon: 'none' })
      return
    }
    const item = this.data.item
    util.callApi('report', {
      targetType: 'user',
      targetOpenid: item._openid,
      targetNickName: item.publisherNickName || '该用户',
      reason: reason
    })
      .then(() => {
        this.setData({ showReportModal: false, reportReason: '', reportTarget: 'item' })
        wx.showToast({ title: '已收到举报，我们会尽快处理', icon: 'none' })
        util.requestSubscribe('reportResult').then(() => {}, () => {})
      })
      .catch(e => {
        wx.showToast({ title: typeof e === 'string' ? e : '提交失败', icon: 'none' })
      })
  },

  // 阻止弹窗冒泡
  stopPropagation() {}
})
