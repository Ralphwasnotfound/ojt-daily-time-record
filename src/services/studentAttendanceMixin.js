import { authState, refreshProfile } from './auth'
import { accountDestination } from './accountPolicy'
import { formatManilaDate, formatAttendanceRows, presentAttendance } from './supabaseAttendancePresentation.js'
import { attendanceUiState, createStudentAttendanceController } from './supabaseAttendanceController.js'

export default {
  data() {
    return { attendanceUi: attendanceUiState(), attendanceController: null, displayNow: Date.now(), attendanceClock: null }
  },
  computed: {
    attendanceAccountKey() { return `${authState.user?.id}:${authState.profile?.uid}:${authState.profile?.role}:${authState.profile?.status}` },
    attendanceEligible() {
      return authState.provider === 'supabase' && !!authState.user && authState.profile?.uid === authState.user.id &&
        authState.profile?.role === 'student' && authState.profile?.status === 'approved'
    },
    currentDate() { return formatManilaDate(this.displayNow) },
    attendanceDisplay() {
      if (!this.attendanceUi.ready) return {
        studentName: authState.profile?.fullName || 'Student', date: this.currentDate,
        status: this.attendanceUi.loading ? 'Loading…' : 'Unavailable', statusNote: 'Awaiting confirmed attendance',
        timeIn: '--', timeOut: '--', todayHours: '--', totalHours: '--', remainingHours: '--',
        requiredHours: authState.profile?.requiredHours ?? 'Unavailable', progressPercent: null,
        rows: [], days: '--', action: 'Time In', completedToday: false,
      }
      return presentAttendance(this.attendanceUi.state, this.attendanceUi.records, authState.profile, this.displayNow)
    },
    // Keep list identity stable across display-clock ticks so Show More stays expanded.
    attendanceHistory() { return this.attendanceUi.ready ? formatAttendanceRows(this.attendanceUi.records) : [] },
    attendanceSummary() {
      return [
        { label: 'Days Present', value: this.attendanceDisplay.days },
        { label: 'Completed Hours', value: this.attendanceDisplay.totalHours },
        { label: 'Required Hours', value: this.attendanceDisplay.requiredHours },
      ]
    },
    attendanceActionDisabled() {
      return !this.attendanceEligible || !this.attendanceUi.ready || this.attendanceUi.busy || this.attendanceDisplay.completedToday
    },
  },
  watch: { attendanceAccountKey() { this.startAttendance() } },
  mounted() {
    this.startAttendance()
    // The display clock only prompts a read; it never unlocks attendance locally.
    this.attendanceClock = setInterval(() => {
      const previousDay = this.currentDate
      this.displayNow = Date.now()
      if (previousDay !== this.currentDate) this.refreshAttendance()
    }, 30000)
    window.addEventListener('focus', this.refreshAttendance)
    window.addEventListener('offline', this.attendanceOffline)
    window.addEventListener('online', this.refreshAttendance)
  },
  beforeUnmount() {
    this.attendanceController?.stop()
    clearInterval(this.attendanceClock)
    window.removeEventListener('focus', this.refreshAttendance)
    window.removeEventListener('offline', this.attendanceOffline)
    window.removeEventListener('online', this.refreshAttendance)
  },
  methods: {
    async startAttendance() {
      this.attendanceController?.stop()
      this.attendanceController = null
      this.attendanceUi = attendanceUiState()
      if (!this.attendanceEligible) {
        this.attendanceUi.loading = false
        this.attendanceUi.error = 'Attendance requires an approved student account.'
        return
      }
      this.attendanceController = createStudentAttendanceController(this.attendanceUi, authState.user.id, this.checkAttendanceAccess)
      if (navigator.onLine === false) this.attendanceController.offline()
      else await this.attendanceController.start()
    },
    async checkAttendanceAccess() {
      await refreshProfile()
      const target = accountDestination(authState.user, authState.profile, authState.profileError)
      if (target !== '/student') await this.$router.replace(target)
    },
    refreshAttendance() {
      if (this.attendanceUi.busy) return
      this.displayNow = Date.now()
      if (navigator.onLine === false) this.attendanceOffline()
      else this.attendanceController?.start()
    },
    attendanceOffline() { this.attendanceController?.offline() },
    async submitAttendance() {
      if (this.attendanceActionDisabled) return
      await this.attendanceController.submit()
    },
    badgeClass(status) { return status === 'Complete' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900' },
  },
}
