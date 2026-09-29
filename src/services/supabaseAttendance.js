import { supabase } from '../supabase/supabase.js'

const messages = {
  ALREADY_TIMED_IN: 'You are already timed in.',
  ALREADY_STARTED_TODAY: 'You have already completed your attendance for today.',
  NO_OPEN_ATTENDANCE: 'There is no active attendance session to time out.',
  APPROVED_STUDENT_REQUIRED: 'Attendance requires an approved student account. Please check your account status.',
  AUTHENTICATION_REQUIRED: 'Please sign in again to record attendance.',
}
export function attendanceErrorMessage(error) {
  return messages[error?.message] || 'Attendance could not be confirmed. Reconnect and refresh attendance before trying again.'
}
export function attendanceAccessError(error) {
  return ['APPROVED_STUDENT_REQUIRED', 'AUTHENTICATION_REQUIRED'].includes(error?.message)
}

// One write at a time across mounted views. No automatic mutation retries.
let pendingWrite = null
export async function waitForAttendanceWrite() { await pendingWrite?.catch(() => {}) }
async function request(query) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    // Explicitly disable SDK retries too: an interrupted write may have committed.
    return await query.retry(false).abortSignal(controller.signal)
  } finally { clearTimeout(timeout) }
}
async function rpc(name) {
  if (!supabase) throw new Error('ATTENDANCE_UNAVAILABLE')
  const { data, error } = await request(supabase.rpc(name))
  if (error) throw error
  return data
}
export async function getAttendanceSummary() {
  const data = await rpc('attendance_summary')
  const summary = data?.[0]
  if (data?.length !== 1 || typeof summary.started_today !== 'boolean' ||
      !Number.isFinite(Number(summary.completed_seconds)) || Number(summary.completed_seconds) < 0 ||
      !Number.isInteger(Number(summary.completed_sessions)) || Number(summary.completed_sessions) < 0 ||
      (!!summary.open_session_id !== !!summary.open_time_in)) throw new Error('INVALID_ATTENDANCE_SUMMARY')
  return summary
}
function write(name) {
  if (pendingWrite) return Promise.reject(new Error('ATTENDANCE_BUSY'))
  const request = rpc(name)
  pendingWrite = request
  return request.finally(() => { if (pendingWrite === request) pendingWrite = null })
}
export function timeIn() { return write('attendance_time_in') }
export function timeOut() { return write('attendance_time_out') }

// Read-only, own-user filter plus RLS. Page through history without truncating at
// the REST row limit. Totals come from the summary, never this list.
export async function getAttendanceHistory(studentId) {
  if (!supabase || !studentId) throw new Error('ATTENDANCE_UNAVAILABLE')
  const records = []
  const size = 200
  for (let offset = 0; ; offset += size) {
    const { data, error } = await request(supabase.from('attendance_sessions')
      .select('id,student_uid,time_in,time_out').eq('student_uid', studentId)
      .order('time_in', { ascending: false }).order('id', { ascending: false })
      .range(offset, offset + size - 1))
    if (error) throw error
    records.push(...data)
    if (data.length < size) return records
  }
}
