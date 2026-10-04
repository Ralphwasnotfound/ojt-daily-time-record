import { ACTIVITY_CATEGORIES } from './supabaseActivityData.js'
export const JOURNAL_ZONE = 'Asia/Manila'
const DAY_MS = 86400000
export function journalRange(from, to = from) {
  const parse = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error('INVALID_JOURNAL_RANGE')
    const n = Date.parse(value + 'T00:00:00Z')
    if (!Number.isFinite(n) || new Date(n).toISOString().slice(0,10) !== value) throw Error('INVALID_JOURNAL_RANGE')
    return n
  }
  const start = parse(from), end = parse(to)
  if (from < '2000-01-01' || to > '2100-12-31' || end < start || end-start > 30*DAY_MS) throw Error('INVALID_JOURNAL_RANGE')
  return { from, to, timezone: JOURNAL_ZONE, dates: Array.from({length:(end-start)/DAY_MS+1},(_,i)=>new Date(start+i*DAY_MS).toISOString().slice(0,10)) }
}
// Separate Complete contract: Daily/Date Range retain journalRange's 31-day cap.
export const COMPLETE_JOURNAL_LIMITS = Object.freeze({ days: 3660, activities: 10000, readMilliseconds: 120000 })
export function journalCompletePeriod(from, to) {
  if (from === null && to === null) return { from, to, timezone: JOURNAL_ZONE, scope: 'complete', dates: [] }
  journalRange(from, from); journalRange(to, to)
  const count = (Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/DAY_MS+1
  if (count < 1) throw Error('INVALID_JOURNAL_RANGE')
  if (count > COMPLETE_JOURNAL_LIMITS.days) throw Error('JOURNAL_COMPLETE_TOO_LARGE')
  return { from, to, timezone: JOURNAL_ZONE, scope: 'complete', dates: Array.from({length:count},(_,i)=>new Date(Date.parse(from+'T00:00:00Z')+i*DAY_MS).toISOString().slice(0,10)) }
}
export function journalDay(timestamp) {
  if (typeof timestamp !== 'string' || !/(Z|[+-]\d{2}:?\d{2})$/.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) throw Error('INVALID_JOURNAL_DATA')
  const parts = new Intl.DateTimeFormat('en-US',{timeZone:JOURNAL_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(timestamp))
  const get = type => parts.find(p=>p.type===type).value
  return `${get('year')}-${get('month')}-${get('day')}`
}
// PostgreSQL timestamps retain microseconds; Date.parse alone loses tie order.
export function journalTimestampKey(value) {
  journalDay(value)
  const fraction=value.match(/\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/)?.[1] || ''
  if(fraction.length>6) throw Error('INVALID_JOURNAL_DATA')
  return BigInt(Math.floor(Date.parse(value)/1000))*1000000n + BigInt(fraction.padEnd(6,'0'))
}
export function journalSeconds(value) {
  if (!['string','number'].includes(typeof value) || value === '' || !Number.isFinite(Number(value)) || Number(value)<0) throw Error('INVALID_JOURNAL_DATA')
  return Number(value) // Preserve authoritative fractional seconds; never round here.
}
export function buildJournalReport({from,to=from,profile,activities,attendanceDays,lifetimeCompletedSeconds,complete=false}) {
  const range=complete?journalCompletePeriod(from,to):journalRange(from,to)
  if (!profile?.fullName || !profile.studentId || !profile.program || !Number.isFinite(profile.requiredHours) || profile.requiredHours<=0) throw Error('INVALID_JOURNAL_PROFILE')
  const days=range.dates.map(date=>({date,activities:[],sessions:[],completedSeconds:0})), byDay=new Map(days.map(d=>[d.date,d]))
  const seen=new Set(), sources=[]
  const ordered=[...activities].sort((a,b)=>journalTimestampKey(a.created_at)<journalTimestampKey(b.created_at)?-1:journalTimestampKey(a.created_at)>journalTimestampKey(b.created_at)?1:(a.id<b.id?-1:a.id>b.id?1:0))
  for (const row of ordered) {
    const day=byDay.get(journalDay(row.created_at))
    if (!day || !row.id || seen.has(row.id) || !ACTIVITY_CATEGORIES.includes(row.category) || typeof row.description!=='string' || !row.description || !Number.isInteger(row.revision) || row.revision<0 || !row.photo_path || !row.attendance_session_id) throw Error('INVALID_JOURNAL_DATA')
    if (row.updated_at) journalDay(row.updated_at)
    seen.add(row.id)
    const sourceIndex=sources.length
    sources.push({id:row.id,revision:row.revision,proofPath:row.photo_path,attendanceSessionId:row.attendance_session_id})
    day.activities.push({sourceIndex,createdAt:row.created_at,category:row.category,description:row.description,edited:row.revision>0,updatedAt:row.updated_at ?? null})
  }
  const seenDays=new Set(), seenSessions=new Set()
  for (const row of attendanceDays) {
    const day=byDay.get(row.start_day)
    if (!day || seenDays.has(row.start_day) || !Array.isArray(row.sessions)) throw Error('INVALID_JOURNAL_DATA')
    seenDays.add(row.start_day); day.completedSeconds=journalSeconds(row.completed_seconds)
    for (const session of [...row.sessions].sort((a,b)=>Number(a.session_ordinal)-Number(b.session_ordinal))) {
      const ordinal=Number(session.session_ordinal), completedSeconds=journalSeconds(session.completed_seconds)
      if (!session.id || seenSessions.has(session.id) || ![1,2].includes(ordinal) || ordinal!==day.sessions.length+1 || journalDay(session.time_in)!==day.date || (!session.time_out && completedSeconds!==0)) throw Error('INVALID_JOURNAL_DATA')
      if (session.time_out) journalDay(session.time_out)
      seenSessions.add(session.id)
      day.sessions.push({ordinal,timeIn:session.time_in,timeOut:session.time_out ?? null,completedSeconds,status:session.time_out?'completed':'open'})
    }
    if (Math.abs(day.sessions.reduce((sum,s)=>sum+s.completedSeconds,0)-day.completedSeconds)>0.000001) throw Error('INVALID_JOURNAL_DATA')
  }
  return {schemaVersion:1,student:{fullName:profile.fullName,studentId:profile.studentId,program:profile.program,requiredHours:profile.requiredHours},range:{from,to,timezone:JOURNAL_ZONE,...(complete?{scope:'complete'}:{})},days,selectedRangeCompletedSeconds:days.reduce((sum,d)=>sum+d.completedSeconds,0),lifetimeCompletedSeconds:journalSeconds(lifetimeCompletedSeconds),internal:{sources,consistency:'current-reads-not-transactional-snapshot'}}
}

// Shared by the preview and every export format; attendance never grants eligibility.
export const JOURNAL_EMPTY_ACTIVITY_MESSAGE = 'No activity recorded for this day.'
export function canExportJournal(report) {
  return Boolean(report?.days?.some(day => Array.isArray(day.activities) && day.activities.length > 0))
}
export function requireJournalActivities(report) {
  if (!canExportJournal(report)) throw Error('JOURNAL_NO_ACTIVITIES')
}
