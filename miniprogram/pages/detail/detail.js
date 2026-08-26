const app = getApp()
const util = require('../../utils/util')

Page({
  data: {
    itemId: '',
    item: null,
    isOwner: false,
    isCompleted: false,

    // 申请相关
    applications: [],
    showApplyModal: false,
    applyMessage: '',

    // 举报相关
    showReportModal: false,
    reportReason: '',

    // 当前用户（已登录才有值，游客为 null）
    currentUser: null,

    // 登录态（游客只能浏览，不能申请/交换/举报）
    isLoggedIn: false
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
      createTimeStr: util.formatTime(new Date(item.createTime).getTime())
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
      this.setData({
        item,
        isOwner: res.isOwner,
        isCompleted: item.status === 'completed',
        currentUser: app.getUserInfo() || null
      })
      if (res.isOwner) this.loadApplications()
    } catch (e) {
      wx.showToast({ title: typeof e === 'string' ? e : '加载失败', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
    }
  },

  // ========== 申请记录加载（仅发布者） ==========
  loadApplications() {
    util.callApi('applications', { itemId: this.data.itemId })
      .then(res => {
        const list = res.list.map(a => Object.assign({}, a, {
          applicantName: a.applicantNickName || '匿名',
          applicantAvatar: a.applicantAvatarUrl || '',
          createTimeStr: util.formatTime(new Date(a.createTime).getTime())
        }))
        this.setData({ applications: list })
      })
      .catch(() => {})
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

    const userInfo = app.getUserInfo() || {}
    const item = this.data.item
    util.callApi('apply', {
      itemId: this.data.itemId,
      message: message,
      itemTitle: item.title,
      applicantNickName: userInfo.nickName || '公益参与者',
      applicantAvatarUrl: userInfo.avatarUrl || ''
    })
      .then(() => {
        this.setData({ showApplyModal: false, applyMessage: '' })
        this.loadApplications()
        wx.showToast({ title: '申请已提交', icon: 'success' })
      })
      .catch(e => {
        wx.showToast({ title: typeof e === 'string' ? e : '提交失败', icon: 'none' })
      })
  },

  // ========== 发布者确认送出 ==========
  approveApplication(e) {
    const applicationId = e.currentTarget.dataset.id
    const that = this
    wx.showModal({
      title: '确认送出',
      content: '确认将物品送给这位申请者吗？确认后物品状态将变为"已完成"。',
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
      content: '确认该物品已成功送出吗？确认后您将获得10点公益积分。',
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
        app.updateUserStats(10, 1)
        this.loadItem()
        wx.showToast({ title: '物品已确认送出，积分+10', icon: 'success' })
      })
      .catch(e => {
        wx.showToast({ title: typeof e === 'string' ? e : '操作失败', icon: 'none' })
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

  // ========== 举报流程 ==========
  openReport() {
    // 游客只能浏览，举报需先登录（避免匿名滥用）
    if (!util.requireLogin()) return
    this.setData({ showReportModal: true, reportReason: '' })
  },

  closeReport() {
    this.setData({ showReportModal: false, reportReason: '' })
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
      })
      .catch(e => {
        wx.showToast({ title: typeof e === 'string' ? e : '提交失败', icon: 'none' })
      })
  },

  // 阻止弹窗冒泡
  stopPropagation() {}
})
