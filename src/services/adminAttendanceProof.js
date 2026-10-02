import { supabase } from '../supabase/supabase.js'
import { adminKey } from './supabaseAdmin.js'
import { createAttendanceProofReader } from './attendanceProofReader.js'
export { formatProof } from './attendanceProofReader.js'

export function createAdminAttendanceProofApi(client, identity) {
  return createAttendanceProofReader(client, identity, 'admin')
}
export const adminAttendanceProofApi = createAdminAttendanceProofApi(supabase, adminKey)
