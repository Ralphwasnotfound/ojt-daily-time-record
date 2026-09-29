import { watchAttendanceState, getAttendanceState, getAllStudentAttendance, timeIn, timeOut, mapAttendanceError } from './attendance.js'
import { validateAttendanceHistory } from './attendancePresentation.js'

export function attendanceUiState() {
  return { state: null, records: [], ready: false, loading: true, busy: false, error: '', notice: '' }
}
export function attendanceMessage(error) {
  const mapped = mapAttendanceError(error)
  if (mapped.code === 'OFFLINE') return 'Attendance cannot be confirmed while offline. Check your connection and refresh.'
  if (mapped.code === 'ATTENDANCE_INCONSISTENT') return 'Your attendance record needs review. Please contact the administrator.'
  return mapped.message
}

// Each mounted page owns its subscription; Firestore is the shared source of truth.
export function createStudentAttendanceController(model, onAccessError = () => {}) {
  let stopped = false, version = 0, unsubscribe = null
  function fail(error) {
    model.notice = ''
    model.ready = false
    model.loading = false
    model.error = attendanceMessage(error)
    const code = mapAttendanceError(error).code
    if (['NOT_AUTHENTICATED', 'NOT_APPROVED_STUDENT', 'PERMISSION_DENIED'].includes(code)) onAccessError()
  }
  async function load(state, ticket) {
    const current = () => !stopped && ticket === version
    try {
      const records = await getAllStudentAttendance(current)
      if (!current() || records === null) return false
      validateAttendanceHistory(state, records)
      model.state = state
      model.records = records
      model.error = ''
      model.ready = true
      model.loading = false
      return true
    } catch (error) { if (current()) fail(error); return false }
  }
  function receive(state) {
    if (stopped || model.busy) return
    const ticket = ++version
    model.ready = false
    model.loading = true
    model.error = ''
    void load(state, ticket)
  }
  function stopListener() { unsubscribe?.(); unsubscribe = null }
  function start() {
    if (stopped) return
    stopListener()
    version++
    model.ready = false
    model.loading = true
    model.error = ''
    try {
      unsubscribe = watchAttendanceState(receive, error => {
        if (!stopped && !model.busy) { version++; fail(error) }
      }, () => {
        if (!stopped && !model.busy) {
          version++
          model.ready = false
          model.loading = false
          model.error = 'Waiting for server confirmation. Cached or offline attendance is not confirmed.'
        }
      })
    } catch (error) { fail(error) }
  }
  async function submit() {
    if (stopped || model.busy || !model.ready) return
    const action = model.state?.status === 'IN' ? 'Time Out' : 'Time In'
    model.busy = true
    model.notice = ''
    model.error = ''
    model.ready = false
    const ticket = ++version
    stopListener()
    let committed = false
    try {
      const result = await (action === 'Time In' ? timeIn() : timeOut())
      committed = true
      if (stopped || ticket !== version) return
      const state = await getAttendanceState()
      if (!state || state.sessionId !== result.sessionId || state.status !== (action === 'Time In' ? 'IN' : 'OUT')) {
        throw new Error('ATTENDANCE_INCONSISTENT')
      }
      if (await load(state, ticket)) model.notice = `${action} recorded successfully.`
      else if (!stopped) model.notice = 'The write was acknowledged, but attendance could not be refreshed. Refresh to confirm the record.'
    } catch (error) {
      if (!stopped && ticket === version) {
        fail(error)
        if (committed) model.notice = 'The write was acknowledged, but attendance could not be refreshed. Refresh to confirm the record.'
      }
    } finally {
      if (!stopped && ticket === version) {
        model.busy = false
        // Keep failed actions blocked until the user explicitly refreshes/reconciles.
        if (model.ready) start()
      }
    }
  }
  return {
    start, submit,
    offline() {
      if (stopped) return
      // Never cancel/claim failure for an in-flight commit; its result must be reconciled.
      if (!model.busy) { version++; stopListener(); fail({ code: 'unavailable' }) }
    },
    stop() { stopped = true; version++; stopListener() },
  }
}
