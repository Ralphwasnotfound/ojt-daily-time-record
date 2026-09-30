export const ACTIVITY_CATEGORIES = Object.freeze([
  'Programming / Development', 'IT Support', 'Hardware / Maintenance', 'Documentation',
  'Training / Seminar', 'Meeting', 'Administrative Work', 'Other',
])
export const PHOTO_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp'])
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024
export function characterCount(value) { return Array.from(value || '').length }
export function activityContent(category, description) {
  if (!ACTIVITY_CATEGORIES.includes(category)) throw new Error('INVALID_CATEGORY')
  const text = typeof description === 'string' ? description.trim() : ''
  if (!text || characterCount(text) > 500 || text.includes('\u0000')) throw new Error('INVALID_DESCRIPTION')
  return { category, description: text }
}
const errors = {
  AUTHENTICATION_REQUIRED: 'Please sign in again.',
  APPROVED_STUDENT_REQUIRED: 'Activities require an approved student account.',
  NO_OPEN_ATTENDANCE: 'Time In before submitting an activity update.',
  INVALID_CATEGORY: 'Select a valid activity category.',
  INVALID_DESCRIPTION: 'Enter a description of 1 to 500 characters.',
  INVALID_UPLOAD: 'This photo reservation is no longer valid. Clear the draft after checking its status.',
  PROOF_REQUIRED: 'Add a photo before submitting your activity.',
  INVALID_PROOF: 'Choose a valid JPEG, PNG or WebP image of up to 5 MiB.',
  UPLOAD_EXPIRED_OR_DISCARDED: 'This photo reservation expired. Clear the draft, then deliberately start again.',
  ACTIVITY_ALREADY_EXISTS: 'This activity was already submitted. Check its current record.',
  ACTIVITY_NOT_FOUND: 'This activity is unavailable.',
  ACTIVITY_CHANGED: 'This activity changed elsewhere. The current server version has been reloaded. Review it before editing again.',
  PROOF_IN_USE: 'This photo belongs to a saved activity and cannot be removed.',
  REQUEST_CONFLICT: 'This submission reference is already in use. Check its current record.',
  INVALID_PAGE: 'Unable to load that page. Refresh activity history.',
  PHOTO_TOO_LARGE: 'Choose an image no larger than 5 MiB.',
  PHOTO_DECODE_FAILED: 'This image could not be opened. Choose a valid JPEG, PNG or WebP image.',
}
export function activityError(error) {
  return Object.hasOwn(errors, error?.message) ? errors[error.message]
    : 'The result could not be confirmed. Check your connection, then check or retry this same submission.'
}
export function activityDate(value) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(value))
}
export function activityTime(value) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}
