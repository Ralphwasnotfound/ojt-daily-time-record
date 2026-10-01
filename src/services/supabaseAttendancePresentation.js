const zone = 'Asia/Manila'
export function formatManilaDate(value, weekdayOnly = false) {
  return new Intl.DateTimeFormat('en-US', { timeZone: zone,
    ...(weekdayOnly ? { weekday: 'long' } : { month: 'long', day: 'numeric', year: 'numeric' }),
  }).format(new Date(value))
}
function time(value) {
  return value ? new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : '--'
}
export function duration(seconds) {
  const minutes = Math.floor(Number(seconds) / 60)
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}
// Per-session elapsed time is display-only from server timestamps. Authoritative
// accumulated hours always use PostgreSQL's completed_seconds (including fractions).
function elapsed(row) { return row?.time_out ? (Date.parse(row.time_out) - Date.parse(row.time_in)) / 1000 : 0 }
export function formatAttendanceRows(records) {
  return records.map(row => ({
    id: row.id, date: formatManilaDate(row.time_in), day: formatManilaDate(row.time_in, true),
    timeIn: time(row.time_in), timeOut: row.time_out && formatManilaDate(row.time_out) !== formatManilaDate(row.time_in)
      ? `${time(row.time_out)} (${formatManilaDate(row.time_out)})` : time(row.time_out),
    hours: row.time_out ? duration(elapsed(row)) : 'Not completed',
    status: row.time_out ? 'Complete' : 'IN / ongoing',
  }))
}
export function presentAttendance(summary, records, profile, now) {
  const open = !!summary.open_session_id
  const relevant = open ? { time_in: summary.open_time_in, time_out: null } : summary.starts_today ? summary.today_sessions.at(-1) : null
  const total = Number(summary.completed_seconds)
  const required = profile?.requiredHours
  const validRequired = Number.isFinite(required) && required > 0
  return {
    studentName: profile?.fullName || 'Student', date: formatManilaDate(now),
    status: open ? 'IN' : 'OUT',
    statusNote: open ? `Currently IN · Session ${summary.open_session_ordinal} · Since ${time(summary.open_time_in)}` : summary.next_action === 'none' ? 'Attendance completed for today' : summary.starts_today === 1 ? 'First session completed' : 'Ready to Time In',
    carriedOver: open && formatManilaDate(summary.open_time_in) !== formatManilaDate(summary.manila_day + 'T00:00:00+08:00'),
    sessionDate: relevant ? formatManilaDate(relevant.time_in) : '',
    timeIn: time(relevant?.time_in), timeOut: time(relevant?.time_out),
    todayHours: duration(summary.today_completed_seconds),
    totalHours: duration(total), requiredHours: validRequired ? required : 'Unavailable',
    remainingHours: validRequired ? duration(Math.max(0, required * 3600 - total)) : 'Unavailable',
    progressPercent: validRequired ? Math.min(100, Math.floor(total / (required * 3600) * 10000) / 100) : null,
    days: Number(summary.days_present),
    action: summary.next_action === 'time_out' ? 'Time Out' : summary.starts_today === 1 ? 'Time In Again' : 'Time In', completedToday: summary.next_action === 'none',
  }
}
