var app = getApp()
var util = require('../../utils/util')

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

  onLoad: function (options) {
    var itemId = options.id
    if (!itemId) {
      wx.showToast({ title: '物品不存在', icon: 'none' })
      setTimeout(function () { wx.navigateBack() }, 1500)
      return
    }

    this.setData({ itemId: itemId })
    this.loadItem()
    this.loadApplications()
  },

  onShow: function () {
    // 每次显示时重新加载
    if (this.data.itemId) {
      this.loadItem()
      this.loadApplications()
    }
  },

  // ========== 物品加载 ==========
  loadItem: function () {
    var items = wx.getStorageSync('items') || []
    var item = null
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === this.data.itemId) {
        item = items[i]
        break
      }
    }

    if (!item) {
      wx.showToast({ title: '物品不存在', icon: 'none' })
      setTimeout(function () { wx.navigateBack() }, 1500)
      return
    }

    var userInfo = app.getUserInfo()
    var currentUser = userInfo || {}
    var isOwner = currentUser.nickName === item.publisherNickName
    var isCompleted = item.status === 'completed'

    this.setData({ item: item, isOwner: isOwner, isCompleted: isCompleted, currentUser: currentUser })
  },

  // ========== 申请记录加载 ==========
  loadApplications: function () {
    var applications = wx.getStorageSync('applications') || []
    var itemApplications = []
    for (var i = 0; i < applications.length; i++) {
      if (applications[i].itemId === this.data.itemId) {
        itemApplications.push(applications[i])
      }
    }
    this.setData({ applications: itemApplications })
  },

  // ========== 图片预览 ==========
  previewImage: function (e) {
    var index = e.currentTarget.dataset.index
    wx.previewImage({
      current: this.data.item.images[index],
      urls: this.data.item.images
    })
  },

  // ========== 申请流程 ==========
  openApply: function () {
    this.setData({ showApplyModal: true, applyMessage: '' })
  },

  closeApply: function () {
    this.setData({ showApplyModal: false, applyMessage: '' })
  },

  onApplyMessageInput: function (e) {
    this.setData({ applyMessage: e.detail.value })
  },

  submitApply: function () {
    var message = this.data.applyMessage.trim()
    if (!message) {
      wx.showToast({ title: '请填写申请留言', icon: 'none' })
      return
    }

    // 内容安全审核
    var textCheck = util.checkTextContent(message)
    if (!textCheck.passed) {
      wx.showToast({ title: '留言包含敏感词，请修改', icon: 'none' })
      return
    }

    var userInfo = app.getUserInfo()
    var now = Date.now()
    var application = {
      id: util.generateId(),
      itemId: this.data.itemId,
      applicantId: userInfo.nickName,
      applicantName: userInfo.nickName,
      applicantAvatar: userInfo.avatarUrl,
      message: message,
      status: 'pending',
      createTime: now,
      createTimeStr: util.formatTime(now)
    }

    var applications = wx.getStorageSync('applications') || []
    applications.push(application)
    wx.setStorageSync('applications', applications)

    /*
     * ========== 订阅消息（需自行替换模板ID） ==========
     * 使用说明：
     * 1. 在微信公众平台 → 功能 → 订阅消息，申请模板（如"申请通知"）
     * 2. 将下面的 'YOUR_TEMPLATE_ID' 替换为实际模板ID
     * 3. 取消注释以下代码即可生效
     *
     * wx.requestSubscribeMessage({
     *   tmplIds: ['YOUR_TEMPLATE_ID'],
     *   success: function(res) {
     *     console.log('订阅消息授权：', res)
     *   },
     *   fail: function(err) {
     *     console.log('订阅消息失败：', err)
     *   }
     * })
     *
     * 注意：由于本小程序不使用云服务，无法从服务端发送订阅消息。
     * 实际项目中需配合服务端调用 subscribeMessage.send API。
     */

    this.setData({ showApplyModal: false, applyMessage: '' })
    this.loadApplications()
    wx.showToast({ title: '申请已提交', icon: 'success' })
  },

  // ========== 发布者确认送出 ==========
  approveApplication: function (e) {
    var applicationId = e.currentTarget.dataset.id
    var that = this

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

  confirmComplete: function () {
    var that = this
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
  doCompleteItem: function (approvedApplicationId) {
    var items = wx.getStorageSync('items') || []
    var itemIndex = -1
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === this.data.itemId) {
        itemIndex = i
        break
      }
    }
    if (itemIndex === -1) return

    var now = Date.now()
    items[itemIndex].status = 'completed'
    items[itemIndex].completeTime = now

    wx.setStorageSync('items', items)

    // 更新申请状态
    if (approvedApplicationId) {
      var applications = wx.getStorageSync('applications') || []
      for (var j = 0; j < applications.length; j++) {
        if (applications[j].itemId === this.data.itemId) {
          applications[j].status = applications[j].id === approvedApplicationId ? 'approved' : 'rejected'
        }
      }
      wx.setStorageSync('applications', applications)
    }

    // 给发布者加积分
    app.updateUserStats(10, 1)

    this.loadItem()
    this.loadApplications()
    wx.showToast({ title: '物品已确认送出，积分+10', icon: 'success' })
  },

  // ========== 举报流程 ==========
  openReport: function () {
    this.setData({ showReportModal: true, reportReason: '' })
  },

  closeReport: function () {
    this.setData({ showReportModal: false, reportReason: '' })
  },

  onReportReasonInput: function (e) {
    this.setData({ reportReason: e.detail.value })
  },

  submitReport: function () {
    var reason = this.data.reportReason.trim()
    if (!reason) {
      wx.showToast({ title: '请填写举报理由', icon: 'none' })
      return
    }

    // 内容安全审核
    var textCheck = util.checkTextContent(reason)
    if (!textCheck.passed) {
      wx.showToast({ title: '举报理由包含敏感词', icon: 'none' })
      return
    }

    var userInfo = app.getUserInfo()
    var now = Date.now()
    var report = {
      id: util.generateId(),
      itemId: this.data.itemId,
      reporterName: userInfo.nickName,
      reason: reason,
      createTime: now,
      createTimeStr: util.formatTime(now)
    }

    var reports = wx.getStorageSync('reports') || []
    reports.push(report)
    wx.setStorageSync('reports', reports)

    this.setData({ showReportModal: false, reportReason: '' })
    wx.showToast({ title: '已收到举报，我们会尽快处理', icon: 'none' })
  },

  // 阻止弹窗冒泡
  stopPropagation: function () {}
})
