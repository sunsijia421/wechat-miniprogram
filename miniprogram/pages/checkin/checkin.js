const app = getApp()
const util = require('../../utils/util')

Page({
  data: {
    year: 0,
    month: 0,         // 1-12
    monthLabel: '',
    weekHeader: ['日', '一', '二', '三', '四', '五', '六'],
    days: [],         // {day, signed, isToday, isFuture}
    streak: 0,
    total: 0,
    signedToday: false,
    todayPoints: 2,
    checking: false
  },

  onShow() {
    const now = new Date()
    this.loadMonth(now.getFullYear(), now.getMonth() + 1)
    this.loadStatus()
  },

  loadStatus() {
    util.callApi('checkInStatus').then(res => {
      this.setData({ streak: res.streak || 0, signedToday: res.signed })
    }).catch(() => {})
  },

  loadMonth(y, m) {
    this.setData({ year: y, month: m, monthLabel: y + '年' + m + '月' })
    util.callApi('checkinMonth', { month: y + '-' + String(m).padStart(2, '0') }).then(res => {
      const signedSet = new Set(res.signedDates || [])
      this.buildCalendar(y, m, signedSet)
      this.setData({ total: res.total || 0 })
    }).catch(() => {
      this.buildCalendar(y, m, new Set())
    })
  },

  buildCalendar(y, m, signedSet) {
    const today = this.todayKey()
    const first = new Date(y, m - 1, 1)
    const startWeek = first.getDay() // 0=周日
    const daysInMonth = new Date(y, m, 0).getDate()
    const days = []
    // 前置空格
    for (let i = 0; i < startWeek; i++) days.push(null)
    for (let d = 1; d <= daysInMonth; d++) {
      const key = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')
      days.push({
        day: d,
        key,
        signed: signedSet.has(key),
        isToday: key === today,
        isFuture: key > today
      })
    }
    this.setData({ days })
  },

  todayKey() {
    const d = new Date(Date.now() + 8 * 3600 * 1000)
    const p = n => String(n).padStart(2, '0')
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate())
  },

  prevMonth() {
    let { year, month } = this.data
    month--
    if (month < 1) { month = 12; year-- }
    this.loadMonth(year, month)
  },

  nextMonth() {
    let { year, month } = this.data
    month++
    if (month > 12) { month = 1; year++ }
    const now = new Date()
    if (year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth() + 1)) {
      wx.showToast({ title: '不能查看未来月份', icon: 'none' })
      return
    }
    this.loadMonth(year, month)
  },

  doCheckIn() {
    if (this.data.checking || this.data.signedToday) return
    this.setData({ checking: true })
    util.callApi('checkIn').then(res => {
      this.setData({ checking: false, signedToday: true })
      wx.showToast({ title: res.bonus ? `签到+${res.points}（连签奖励+${res.bonus}）` : '签到成功 +2', icon: 'none' })
      this.loadStatus()
      this.loadMonth(this.data.year, this.data.month)
    }).catch(e => {
      this.setData({ checking: false })
      wx.showToast({ title: typeof e === 'string' ? e : '签到失败', icon: 'none' })
    })
  }
})
