import * as attendance from './supabaseAttendance.js'

export function attendanceUiState() {
  return { state: null, records: [], ready: false, loading: true, busy: false, error: '', notice: '', confirmedSession: null }
}

export function createStudentAttendanceController(model, studentId, onAccessError = () => {}, api = attendance) {
  let stopped = false
  let revision = 0
  let refreshing = false
  const current = version => !stopped && version === revision
  async function reconcile(version) {
    try {
      // A previous view may have submitted a write before unmounting.
      await api.waitForAttendanceWrite()
      if (!current(version)) return
      const state = await api.getAttendanceSummary()
      if (!current(version)) return
      // Summary is a single authoritative snapshot; do not fetch all history to
      // infer action eligibility or compare totals against a paginated list.
      const records = state.today_sessions
      if (!Array.isArray(records) || records.some(row => row.student_uid !== studentId) ||
          new Set(records.map(row => row.id)).size !== records.length ||
          !['time_in','time_out','none'].includes(state.next_action)) throw new Error('INVALID_ATTENDANCE_SUMMARY')
      model.records = records
      model.state = state
      model.ready = true
    } catch (error) {
      if (!current(version)) return
      model.ready = false
      model.error = attendance.attendanceErrorMessage(error)
      if (attendance.attendanceAccessError(error)) await onAccessError()
    } finally {
      if (current(version)) model.loading = false
    }
  }
  return {
    async start() {
      if (stopped || model.busy || refreshing) return
      refreshing = true
      const version = ++revision
      model.ready = false
      model.loading = true
      model.error = ''
      model.notice = ''
      try { await reconcile(version) } finally { refreshing = false }
    },
    async confirmProof(receipt) {
      if (stopped || model.busy) return
      if (receipt?.student_uid !== studentId || !receipt.attendance_session_id ||
          !['time_in', 'time_out'].includes(receipt.action_type) || !receipt.official_punch_at) return
      const version = ++revision
      model.busy = true; model.ready = false; model.error = ''
      // Only a validated immutable proof receipt reaches this read-only controller.
      // Never fabricate an attendance row from photo/location data.
      model.confirmedSession = { id: receipt.attendance_session_id, student_uid: studentId }
      model.notice = `${receipt.action_type === 'time_out' ? 'Time Out' : 'Time In'} recorded by the server.`
      try { await reconcile(version) }
      finally { if (current(version)) model.busy = false }
    },
    offline() {
      if (stopped) return
      model.ready = false
      model.error = 'You are offline. Reconnect and refresh attendance to confirm its current state.'
      // Do not interrupt an outstanding mutation's reconciliation.
      if (!model.busy) { revision++; model.loading = false }
    },
    stop() { stopped = true; revision++; Object.assign(model, attendanceUiState(), { loading: false }) },
  }
}
