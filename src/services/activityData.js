import { Timestamp } from 'firebase/firestore'
import { manilaDay } from './attendanceTime.js'

export const ACTIVITY_CATEGORIES = Object.freeze([
  'Programming / Development', 'IT Support', 'Hardware / Maintenance', 'Documentation',
  'Training / Seminar', 'Meeting', 'Administrative Work', 'Other',
])

export function normalizeActivityDescription(value) {
  if (typeof value !== 'string') throw new Error('INVALID_DESCRIPTION')
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 500) throw new Error('INVALID_DESCRIPTION')
  return trimmed
}

// UTC+8 boundaries, independent of the browser timezone. Only used for queries.
export function activityManilaDayRange(timestamp = Timestamp.now()) {
  const seconds = manilaDay(timestamp) * 86400 - 8 * 3600
  return { start: new Timestamp(seconds, 0), end: new Timestamp(seconds + 86400, 0) }
}
