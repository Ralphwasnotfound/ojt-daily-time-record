import { supabase } from '../supabase/supabase.js'
import { authState } from './auth'
import { createAttendanceProofReader } from './attendanceProofReader.js'

export function studentProofKey() {
  const p = authState.profile
  return authState.provider === 'supabase' && p?.uid === authState.user?.id && p?.role === 'student' && p?.status === 'approved' ? p.uid : ''
}
export const studentAttendanceProofApi = createAttendanceProofReader(supabase, studentProofKey, 'student')

// Decorate only the currently loaded bounded history page. Never prefetch selfies.
export async function withStudentProofAvailability(history, studentUid) {
  const abort = new AbortController()
  let timer, rows = []
  try {
    rows = await Promise.race([
      studentAttendanceProofApi.available(studentUid, history.days.flatMap(day => day.sessions.map(s => s.id)), abort.signal),
      new Promise((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error('TIMEOUT')) }, 10000) }),
    ])
  } catch { /* Attendance stays readable; unknown availability never exposes a button. Refresh retries. */ }
  finally { clearTimeout(timer) }
  return { ...history, days: history.days.map(day => ({ ...day, sessions: day.sessions.map(session => ({
    ...session, proofActions: rows.filter(row => row.attendance_session_id === session.id).map(row => row.action_type),
  })) })) }
}
