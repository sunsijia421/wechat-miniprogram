// 我的公益证书（P4 亮点：送出即生成，可保存分享）
const util = require('../../utils/util')
const app = getApp()

Page({
  data: {
    list: [],
    loading: false,
    isEmpty: false,
    showCert: false,
    current: null,
    saving: false
  },

  onShow() {
    if (!util.requireLogin()) return
    this.loadList()
  },

  loadList() {
    if (this.data.loading) return
    this.setData({ loading: true })
    util.callApi('myCertificates', {})
      .then(res => {
        const list = res.list || []
        this.setData({ list, loading: false, isEmpty: list.length === 0 })
      })
      .catch(e => {
        this.setData({ loading: false })
        wx.showToast({ title: typeof e === 'string' ? e : '加载失败', icon: 'none' })
      })
  },

  // 查看证书 → 绘制 canvas
  viewCert(e) {
    const id = e.currentTarget.dataset.id
    const cert = this.data.list.find(c => c.id === id)
    if (!cert) return
    this.setData({ showCert: true, current: cert }, () => {
      setTimeout(() => this.drawCert(), 120)
    })
  },

  closeCert() {
    this.setData({ showCert: false })
  },

  stopPropagation() {},

  drawCert() {
    const cert = this.data.current
    if (!cert) return
    const query = wx.createSelectorQuery()
    query.select('#certCanvas').fields({ node: true, size: true }).exec(res => {
      if (!res || !res[0] || !res[0].node) return
      const canvas = res[0].node
      const ctx = canvas.getContext('2d')
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      const dpr = info.pixelRatio || 2
      const w = res[0].width
      const h = res[0].height
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.scale(dpr, dpr)

      // 背景渐变
      const grad = ctx.createLinearGradient(0, 0, w, h)
      grad.addColorStop(0, '#e8f5e9')
      grad.addColorStop(1, '#c8e6c9')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, w, h)

      // 外框
      ctx.strokeStyle = '#2e7d32'
      ctx.lineWidth = 2
      ctx.strokeRect(10, 10, w - 20, h - 20)
      ctx.lineWidth = 1
      ctx.strokeStyle = 'rgba(46,125,50,0.4)'
      ctx.strokeRect(16, 16, w - 32, h - 32)

      // 标题
      ctx.fillStyle = '#1b5e20'
      ctx.font = 'bold 24px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('校园公益捐赠证书', w / 2, 58)

      // 编号
      ctx.fillStyle = '#4e7a52'
      ctx.font = '12px sans-serif'
      ctx.fillText('编号：' + (cert.certNo || ''), w / 2, 84)

      // 正文
      const userInfo = app.getUserInfo() || {}
      const name = userInfo.nickName || '公益参与者'
      const dateStr = cert.createTimeStr || ''
      ctx.fillStyle = '#1a1a1a'
      ctx.font = '15px sans-serif'
      ctx.fillText('兹证明', w / 2, 132)
      ctx.font = 'bold 20px sans-serif'
      ctx.fillText(name, w / 2, 164)
      ctx.font = '15px sans-serif'
      ctx.fillText('同学，于 ' + dateStr, w / 2, 198)
      ctx.fillText('将「' + (cert.itemTitle || '闲置物品') + '」', w / 2, 226)
      ctx.fillText('无偿转赠给需要的人', w / 2, 254)

      // 感谢语
      ctx.fillStyle = '#2e7d32'
      ctx.font = '14px sans-serif'
      ctx.fillText('感谢你的公益善举，让闲置继续发光', w / 2, 298)

      // 落款
      ctx.fillStyle = '#555'
      ctx.font = '13px sans-serif'
      ctx.fillText('佳禾换物小站', w / 2, h - 46)

      // 印章
      ctx.save()
      ctx.beginPath()
      ctx.arc(w / 2, h - 42, 36, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(183,28,28,0.75)'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.fillStyle = 'rgba(183,28,28,0.75)'
      ctx.font = 'bold 12px sans-serif'
      ctx.fillText('佳禾公益', w / 2, h - 48)
      ctx.fillText('· 诚信 ·', w / 2, h - 28)
      ctx.restore()
    })
  },

  // 保存证书到相册
  saveCert() {
    if (this.data.saving) return
    this.setData({ saving: true })
    const query = wx.createSelectorQuery()
    query.select('#certCanvas').fields({ node: true, size: true }).exec(res => {
      if (!res || !res[0] || !res[0].node) {
        this.setData({ saving: false })
        wx.showToast({ title: '生成失败', icon: 'none' })
        return
      }
      wx.canvasToTempFilePath({
        canvas: res[0].node,
        success: r => {
          wx.saveImageToPhotosAlbum({
            filePath: r.tempFilePath,
            success: () => {
              this.setData({ saving: false })
              wx.showToast({ title: '已保存到相册', icon: 'success' })
            },
            fail: () => {
              this.setData({ saving: false })
              wx.showModal({ title: '保存失败', content: '请在设置中允许"保存到相册"后重试', showCancel: false })
            }
          })
        },
        fail: () => {
          this.setData({ saving: false })
          wx.showToast({ title: '生成失败', icon: 'none' })
        }
      })
    })
  }
})
