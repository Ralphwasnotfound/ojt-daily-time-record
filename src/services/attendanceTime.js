// Firestore timestamps retain nanoseconds. BigInt avoids rounding each interval.
const BILLION = 1000000000n
const MANILA_OFFSET_SECONDS = 8 * 60 * 60

export function timestampNanoseconds(value) {
  if (!value || !Number.isSafeInteger(value.seconds) ||
      !Number.isInteger(value.nanoseconds) || value.nanoseconds < 0 || value.nanoseconds >= 1e9 ||
      value.seconds < -62135596800 || value.seconds > 253402300799) {
    throw new Error('ATTENDANCE_INCONSISTENT')
  }
  return BigInt(value.seconds) * BILLION + BigInt(value.nanoseconds)
}

export function manilaDay(timestamp) {
  timestampNanoseconds(timestamp)
  return Math.floor((timestamp.seconds + MANILA_OFFSET_SECONDS) / 86400)
}

export function sameManilaDay(first, second) {
  return manilaDay(first) === manilaDay(second)
}

// Returns null for an open session, exact nanoseconds for a completed session.
export function calculateSessionDuration(session) {
  const start = timestampNanoseconds(session?.timeIn)
  if (session.status === 'IN' && session.timeOut === null) return null
  if (session.status !== 'OUT') throw new Error('ATTENDANCE_INCONSISTENT')
  const duration = timestampNanoseconds(session.timeOut) - start
  if (duration < 0n) throw new Error('ATTENDANCE_INCONSISTENT')
  return duration
}

export function calculateTotalCompletedDuration(sessions) {
  return sessions.reduce((total, session) => total + (calculateSessionDuration(session) ?? 0n), 0n)
}
