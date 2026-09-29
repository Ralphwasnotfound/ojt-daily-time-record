import { calculateSessionDuration, calculateTotalCompletedDuration, manilaDay, timestampNanoseconds } from './attendanceTime.js'

const minute = 60000000000n
export function formatDuration(duration) {
  const minutes = duration / minute
  return `${minutes / 60n}h ${String(minutes % 60n).padStart(2, '0')}m`
}
function date(value) {
  timestampNanoseconds(value)
  return new Date(value.seconds * 1000 + value.nanoseconds / 1e6)
}
export function formatManilaTime(value) {
  return value ? new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }).format(date(value)) : '--'
}
export function formatManilaDate(value, weekdayOnly = false) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila',
    ...(weekdayOnly ? { weekday: 'long' } : { month: 'long', day: 'numeric', year: 'numeric' }),
  }).format(date(value))
}
export function displayTimestamp(milliseconds) {
  return { seconds: Math.floor(milliseconds / 1000), nanoseconds: (milliseconds % 1000) * 1000000 }
}

// Check a fully loaded history against the separately confirmed current state.
export function validateAttendanceHistory(state, records) {
  calculateTotalCompletedDuration(records)
  const open = records.filter(record => record.status === 'IN')
  if (!state) {
    if (records.length) throw new Error('ATTENDANCE_INCONSISTENT')
    return
  }
  calculateSessionDuration(state)
  const session = records.find(record => record.id === state.sessionId)
  if (!session || session.studentUid !== state.studentUid || session.status !== state.status ||
      timestampNanoseconds(session.timeIn) !== timestampNanoseconds(state.timeIn) ||
      (session.timeOut === null) !== (state.timeOut === null) ||
      (session.timeOut !== null && timestampNanoseconds(session.timeOut) !== timestampNanoseconds(state.timeOut)) ||
      open.length !== (state.status === 'IN' ? 1 : 0) || (open.length && open[0].id !== state.sessionId)) {
    throw new Error('ATTENDANCE_INCONSISTENT')
  }
}

export function formatAttendanceRows(records) {
  return records.map(record => ({
    id: record.id, date: formatManilaDate(record.timeIn), day: formatManilaDate(record.timeIn, true),
    timeIn: formatManilaTime(record.timeIn),
    timeOut: record.timeOut && manilaDay(record.timeOut) !== manilaDay(record.timeIn)
      ? `${formatManilaTime(record.timeOut)} (${formatManilaDate(record.timeOut)})` : formatManilaTime(record.timeOut),
    hours: record.status === 'IN' ? 'Not completed' : formatDuration(calculateSessionDuration(record)),
    status: record.status === 'IN' ? 'IN / ongoing' : 'Complete',
  }))
}

export function presentAttendance(state, records, profile, now) {
  const total = calculateTotalCompletedDuration(records)
  const today = manilaDay(now)
  const todaysRecords = records.filter(record => manilaDay(record.timeIn) === today)
  const todayCompleted = calculateTotalCompletedDuration(todaysRecords)
  const requiredHours = profile?.requiredHours
  const validRequired = Number.isFinite(requiredHours) && requiredHours > 0
  const required = validRequired ? BigInt(Math.round(requiredHours * 3600000)) * 1000000n : null
  const sameDay = state && manilaDay(state.timeIn) === today
  const relevant = state && (sameDay || state.status === 'IN') ? state : null
  return {
    studentName: profile?.fullName || 'Student', date: formatManilaDate(now),
    status: state?.status || 'OUT',
    statusNote: state?.status === 'IN' ? `Since ${formatManilaTime(state.timeIn)}`
      : sameDay ? 'Attendance complete for today' : 'Not timed in today',
    carriedOver: !!(state?.status === 'IN' && !sameDay),
    sessionDate: relevant ? formatManilaDate(relevant.timeIn) : '',
    timeIn: formatManilaTime(relevant?.timeIn), timeOut: formatManilaTime(relevant?.timeOut),
    todayHours: formatDuration(todayCompleted), totalHours: formatDuration(total),
    requiredHours: validRequired ? requiredHours : 'Unavailable',
    remainingHours: required === null ? 'Unavailable' : formatDuration(required > total ? required - total : 0n),
    progressPercent: required === null ? null : Math.min(100, Number(total * 10000n / required) / 100),
    days: new Set(records.map(record => manilaDay(record.timeIn))).size,
    action: state?.status === 'IN' ? 'Time Out' : 'Time In',
    completedToday: !!(sameDay && state.status === 'OUT'),
  }
}
