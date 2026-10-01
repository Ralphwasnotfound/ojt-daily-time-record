import { supabase } from '../supabase/supabase'
import { normalizeStudentId } from './accountPolicy'

// Existing views use camelCase. uid is the authenticated Supabase UUID.
export function profileFromRow(row) {
  if (!row) return null
  return {
    uid: row.id, fullName: row.full_name, studentId: row.student_id,
    email: row.email, program: row.program, role: row.role, status: row.status,
    requiredHours: row.required_hours, department: row.department,
    rosterEligible: row.roster_eligible === true,
    createdAt: row.created_at, approvedAt: row.approved_at, approvedBy: row.approved_by,
  }
}
export async function readProfile(id) {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return profileFromRow(data)
}
export async function createStudentProfile(form) {
  // S1 derives UID/email/role/status/program/hours from trusted database state.
  const { data, error } = await supabase.rpc('complete_student_registration', {
    full_name: form.fullName.trim(), student_id: normalizeStudentId(form.studentId), last_name: form.lastName.trim(),
  })
  if (error) throw error
  return profileFromRow(data)
}
export async function listPendingStudents() {
  // Page through the server cap without silently dropping pending registrations.
  const rows = []
  const pageSize = 100
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from('profiles').select('*')
      .eq('role', 'student').eq('status', 'pending')
      .order('created_at').order('id').range(offset, offset + pageSize - 1)
    if (error) throw error
    rows.push(...data.map(profileFromRow))
    if (data.length < pageSize) return rows
  }
}
export async function reviewStudent(uid, status) {
  if (!['approved', 'rejected'].includes(status)) throw new Error('Invalid review decision.')
  const { data, error } = await supabase.rpc('review_student', { student_uid: uid, decision: status })
  if (error) throw error
  return profileFromRow(data)
}
