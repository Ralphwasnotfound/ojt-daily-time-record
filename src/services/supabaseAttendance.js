import { supabase } from '../supabase/supabase.js'

const messages = {
  DAILY_ATTENDANCE_LIMIT_REACHED: 'You have completed both attendance sessions for today.',
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
async function rpc(name, args) {
  if (!supabase) throw new Error('ATTENDANCE_UNAVAILABLE')
  const { data, error } = await request(args ? supabase.rpc(name, args) : supabase.rpc(name))
  if (error) throw error
  return data
}
export async function getAttendanceSummary() {
  const data = await rpc('attendance_summary')
  const summary = data?.[0]
  if (data?.length !== 1 || !['time_in','time_out','none'].includes(summary.next_action) ||
      !Number.isInteger(Number(summary.starts_today)) || Number(summary.starts_today)<0 || Number(summary.starts_today)>2 ||
      !Array.isArray(summary.today_sessions) || summary.today_sessions.length !== Number(summary.starts_today) ||
      !Number.isFinite(Number(summary.today_completed_seconds)) || Number(summary.today_completed_seconds)<0 ||
      !Number.isInteger(Number(summary.days_present)) || Number(summary.days_present)<0 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(summary.manila_day) || typeof summary.started_today !== 'boolean' ||
      !Number.isFinite(Number(summary.completed_seconds)) || Number(summary.completed_seconds) < 0 ||
      !Number.isInteger(Number(summary.completed_sessions)) || Number(summary.completed_sessions) < 0 ||
      (!!summary.open_session_id !== !!summary.open_time_in)) throw new Error('INVALID_ATTENDANCE_SUMMARY')
  return summary
}
export function trackAttendanceWrite(operation) {
  if (pendingWrite) return Promise.reject(new Error('ATTENDANCE_BUSY'))
  const work = Promise.resolve().then(operation)
  pendingWrite = work
  return work.finally(() => { if (pendingWrite === work) pendingWrite = null })
}

// Bounded whole-day history. Identity is taken from auth.uid() by the RPC.
export function getAttendanceDays(args = {}) { return rpc('attendance_days', args) }
