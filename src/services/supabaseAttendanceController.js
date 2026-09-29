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
      const records = await api.getAttendanceHistory(studentId)
      if (!current(version)) return
      const open = records.filter(row => row.time_out === null)
      // Separate REST reads can straddle another tab's mutation. Fail closed and
      // ask for a refresh rather than present mismatched details/actions.
      if (records.some(row => row.student_uid !== studentId) ||
          new Set(records.map(row => row.id)).size !== records.length ||
          records.length !== Number(state.completed_sessions) + (state.open_session_id ? 1 : 0) ||
          open.length !== (state.open_session_id ? 1 : 0) ||
          (open.length && (open[0].id !== state.open_session_id || open[0].time_in !== state.open_time_in))) {
        throw new Error('ATTENDANCE_CHANGED_DURING_REFRESH')
      }
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
    async submit() {
      if (stopped || model.busy || !model.ready ||
          (!model.state.open_session_id && model.state.started_today)) return
      const version = ++revision
      const closing = !!model.state.open_session_id
      model.busy = true
      model.ready = false
      model.error = ''
      model.notice = ''
      let accessDenied = false
      try {
        const session = await (closing ? api.timeOut() : api.timeIn())
        if (!current(version)) return
        if (!session?.id || session.student_uid !== studentId || !session.time_in ||
            (closing ? !session.time_out : session.time_out !== null)) throw new Error('INVALID_ATTENDANCE_SESSION')
        // Preserve the server receipt even if subsequent reconciliation fails.
        model.confirmedSession = session
        model.records = [session, ...model.records.filter(row => row.id !== session.id)]
        model.notice = `${closing ? 'Time Out' : 'Time In'} recorded by the server.`
      } catch (error) {
        if (!current(version)) return
        model.error = attendance.attendanceErrorMessage(error)
        accessDenied = attendance.attendanceAccessError(error)
      } finally {
        if (current(version)) {
          // Also reconcile rejected/unknown outcomes. Never replay a mutation.
          await reconcile(version)
          if (current(version)) {
            model.busy = false
            if (accessDenied) { model.ready = false; await onAccessError() }
          }
        }
      }
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
