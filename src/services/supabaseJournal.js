import { supabase } from '../supabase/supabase.js'
import { authState } from './auth'
import { readProfile } from './users'
import { approvedActivityStudent, activityAccountKey } from './supabaseActivities.js'
import { getAttendanceSummary } from './supabaseAttendance.js'
import { createJournalReader } from './journalReportService.js'
// Each consumer gets independent cancellation state. No provider or Storage API.
export function createStudentJournalReader() {
  async function rpc(name,args,signal) {
    const deadline=AbortSignal.timeout(15000)
    const {data,error}=await supabase.rpc(name,args).retry(false).abortSignal(AbortSignal.any([signal,deadline]))
    if(error) throw error
    return data
  }
  return createJournalReader({
    identity:()=>approvedActivityStudent()?activityAccountKey():'',
    profile:()=>readProfile(authState.user.id),
    summary:()=>getAttendanceSummary(),
    activityPage:(args,signal)=>rpc('journal_activity_range',args,signal),
    attendancePage:(args,signal)=>rpc('attendance_days',args,signal),
    completePeriod:signal=>rpc('journal_complete_period',{},signal),
    completeActivityPage:(args,signal)=>rpc('journal_complete_activities',args,signal),
    completeAttendancePage:(args,signal)=>rpc('journal_complete_attendance',args,signal),
  })
}
