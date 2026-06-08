const app = getApp()

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

    // 当前用户
    currentUser: null
  },

  onLoad(options) {
    const itemId = options.id
    if (!itemId) {
      wx.showToast({ title: '物品不存在', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
      return
    }

    this.setData({ itemId })
    this.loadItem()
    this.loadApplications()
  },

  onShow() {
    // 每次显示时重新加载（可能从其他页面回来状态变了）
    if (this.data.itemId) {
      this.loadItem()
      this.loadApplications()
    }
  },

  // 加载物品信息
  loadItem() {
    const items = wx.getStorageSync('items') || []
    const item = items.find(i => i.id === this.data.itemId)

    if (!item) {
      wx.showToast({ title: '物品不存在', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
      return
    }

    const userInfo = app.getUserInfo()
    const currentUser = userInfo || {}
    const isOwner = currentUser.nickName === item.publisherNickName
    const isCompleted = item.status === 'completed'

    this.setData({ item, isOwner, isCompleted, currentUser })
  },

  // 加载申请记录
  loadApplications() {
    const applications = wx.getStorageSync('applications') || []
    const itemApplications = applications.filter(a => a.itemId === this.data.itemId)
    this.setData({ applications: itemApplications })
  },

  // 预览图片
  previewImage(e) {
    const index = e.currentTarget.dataset.index
    wx.previewImage({
      current: this.data.item.images[index],
      urls: this.data.item.images
    })
  },

  // 打开申请弹窗
  openApply() {
    this.setData({ showApplyModal: true, applyMessage: '' })
  },

  // 关闭申请弹窗
  closeApply() {
    this.setData({ showApplyModal: false, applyMessage: '' })
  },

  // 输入申请留言
  onApplyMessageInput(e) {
    this.setData({ applyMessage: e.detail.value })
  },

  // 提交申请
  submitApply() {
    const message = this.data.applyMessage.trim()
    if (!message) {
      wx.showToast({ title: '请填写申请留言', icon: 'none' })
      return
    }

    const userInfo = app.getUserInfo()
    const application = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 8),
      itemId: this.data.itemId,
      applicantNickName: userInfo.nickName,
      applicantAvatarUrl: userInfo.avatarUrl,
      message: message,
      status: 'pending', // pending | approved | rejected
      createTime: Date.now()
    }

    const applications = wx.getStorageSync('applications') || []
    applications.push(application)
    wx.setStorageSync('applications', applications)

    this.setData({ showApplyModal: false, applyMessage: '' })
    this.loadApplications()
    wx.showToast({ title: '申请已提交', icon: 'success' })
  },

  // 发布者确认送出（从申请列表中选一人）
  approveApplication(e) {
    const applicationId = e.currentTarget.dataset.id

    wx.showModal({
      title: '确认送出',
      content: '确认将物品送给这位申请者吗？确认后物品状态将变为"已完成"。',
      confirmText: '确认送出',
      cancelText: '再想想',
      success: (res) => {
        if (res.confirm) {
          this.doCompleteItem(applicationId)
        }
      }
    })
  },

  // 发布者直接确认已送出（不从申请列表）
  confirmComplete() {
    wx.showModal({
      title: '确认已送出',
      content: '确认该物品已成功送出吗？确认后您将获得10点公益积分。',
      confirmText: '确认',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          this.doCompleteItem(null)
        }
      }
    })
  },

  // 执行完成物品操作
  doCompleteItem(approvedApplicationId) {
    // 更新物品状态
    const items = wx.getStorageSync('items') || []
    const itemIndex = items.findIndex(i => i.id === this.data.itemId)
    if (itemIndex === -1) return

    items[itemIndex].status = 'completed'
    items[itemIndex].completedTime = Date.now()
    wx.setStorageSync('items', items)

    // 如果有指定申请者，更新申请状态
    if (approvedApplicationId) {
      const applications = wx.getStorageSync('applications') || []
      applications.forEach(a => {
        if (a.itemId === this.data.itemId) {
          a.status = a.id === approvedApplicationId ? 'approved' : 'rejected'
        }
      })
      wx.setStorageSync('applications', applications)
    }

    // 给发布者加分
    app.updateUserStats(10, 1)

    // 刷新页面
    this.loadItem()
    this.loadApplications()
    wx.showToast({ title: '物品已确认送出，积分+10', icon: 'success' })
  },

  // 打开举报弹窗
  openReport() {
    this.setData({ showReportModal: true, reportReason: '' })
  },

  // 关闭举报弹窗
  closeReport() {
    this.setData({ showReportModal: false, reportReason: '' })
  },

  // 输入举报理由
  onReportReasonInput(e) {
    this.setData({ reportReason: e.detail.value })
  },

  // 提交举报
  submitReport() {
    const reason = this.data.reportReason.trim()
    if (!reason) {
      wx.showToast({ title: '请填写举报理由', icon: 'none' })
      return
    }

    const userInfo = app.getUserInfo()
    const report = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 8),
      itemId: this.data.itemId,
      reporterName: userInfo.nickName,
      reason: reason,
      createTime: Date.now()
    }

    const reports = wx.getStorageSync('reports') || []
    reports.push(report)
    wx.setStorageSync('reports', reports)

    this.setData({ showReportModal: false, reportReason: '' })
    wx.showToast({ title: '已收到举报，我们会尽快处理', icon: 'none' })
  },

  // 阻止弹窗冒泡
  stopPropagation() {}
})
