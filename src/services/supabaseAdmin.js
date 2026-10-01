import { supabase } from '../supabase/supabase.js'
import { authState } from './auth'

export function adminKey() {
  const p = authState.profile
  return authState.provider === 'supabase' && p?.uid === authState.user?.id && p?.role === 'admin' && p?.status === 'approved' ? p.uid : ''
}
export function createAdminApi(client, identity) {
  async function request(make) {
    const key = identity()
    if (!key) throw new Error('APPROVED_ADMIN_REQUIRED')
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 20000)
    try {
      const { data, error } = await make(abort.signal)
      if (!identity() || identity() !== key) throw new Error('ACCOUNT_CHANGED')
      if (error) throw error
      return data
    } finally { clearTimeout(timer) }
  }
  const rpc = (name, args = {}) => request(signal => client.rpc(name, args).retry(false).abortSignal(signal))
  return {
    roster: (args = {}) => rpc('admin_authorized_students', args),
    addRoster: (studentId, expectedName) => rpc('admin_add_authorized_student', { student_id: studentId, expected_name: expectedName }),
    updateRosterName: (studentId, expectedName) => rpc('admin_update_authorized_student_name', { student_id: studentId, expected_name: expectedName }),
    setRosterActive: (studentId, active) => rpc('admin_set_authorized_student_active', { student_id: studentId, is_active: active }),
    dashboard: () => rpc('admin_dashboard'),
    students: (args = {}) => rpc('admin_students', args),
    activities: (args = {}) => rpc('admin_activities', args),
    activityStudents: (args = {}) => rpc('admin_activity_students', args),
    attendance: (args = {}) => rpc('admin_attendance', args),
    revisions: (args = {}) => rpc('admin_activity_revisions', args),
    download: path => request(signal => client.storage.from('activity-proofs').download(path, {}, { signal, cache: 'no-store' })),
  }
}
export const adminApi = createAdminApi(supabase, adminKey)
export function adminError() { return 'Unable to load these records. Check your connection and administrator access, then refresh.' }
export function hours(seconds) {
  const minutes = Math.floor(Number(seconds || 0) / 60)
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}
export function progress(row) { return row.required_hours > 0 ? Math.min(100, Number(row.completed_seconds) / (row.required_hours * 3600) * 100) : 0 }
export function revisionLabel(row) {
  return `${row.migration_baseline ? 'Migration baseline · ' : ''}${row.revision === 0 ? 'Original' : 'Edit #' + row.revision}${row.revision === row.current_revision ? ' · Current' : ''}`
}
