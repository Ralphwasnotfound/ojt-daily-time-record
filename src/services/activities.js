import {
  collection, doc, runTransaction, serverTimestamp, getDocFromServer, getDocsFromServer,
  query, where, orderBy, limit, startAfter, refEqual,
} from 'firebase/firestore'
import { auth, db } from '../firebase/firebase'
import { ACTIVITY_CATEGORIES, normalizeActivityDescription, activityManilaDayRange } from './activityData.js'
import { timestampNanoseconds } from './attendanceTime.js'

const messages = {
  NOT_AUTHENTICATED: 'Sign in before accessing activities.',
  NOT_APPROVED_STUDENT: 'Activities require an approved student account.',
  NO_OPEN_ATTENDANCE: 'You must Time In before submitting an activity.',
  SESSION_CHANGED: 'Your attendance session changed. Review your activity before trying again.',
  ATTENDANCE_INCONSISTENT: 'Your attendance record needs administrator review.',
  INVALID_ACTIVITY: 'The activity reference is invalid.',
  INVALID_CATEGORY: 'Select a valid activity category.',
  INVALID_DESCRIPTION: 'Enter a description of 1 to 500 characters.',
  ALREADY_EXISTS: 'This activity ID already exists. Refresh to confirm its submission.',
  INVALID_QUERY: 'The activity query or cursor is invalid.',
  OFFLINE: 'Unable to reach activity services. Check your connection and retry.',
  PERMISSION_DENIED: 'Activity access was denied. Refresh your account and attendance status.',
  ACTIVITY_FAILED: 'Unable to confirm the activity. Check its submission before retrying.',
}
export class ActivityError extends Error {
  constructor(code) { super(messages[code]); this.name = 'ActivityError'; this.code = code }
}
export function mapActivityError(error) {
  if (error instanceof ActivityError) return error
  if (Object.hasOwn(messages, error?.message)) return new ActivityError(error.message)
  if (['unavailable', 'deadline-exceeded'].includes(error?.code)) return new ActivityError('OFFLINE')
  if (error?.code === 'permission-denied') return new ActivityError('PERMISSION_DENIED')
  if (error?.code === 'unauthenticated') return new ActivityError('NOT_AUTHENTICATED')
  return new ActivityError('ACTIVITY_FAILED')
}
async function perform(operation) {
  try { return await operation() } catch (error) { throw mapActivityError(error) }
}
function uidNow() {
  if (!auth.currentUser) throw new ActivityError('NOT_AUTHENTICATED')
  return auth.currentUser.uid
}
function sameUser(uid) {
  if (auth.currentUser?.uid !== uid) throw new ActivityError('NOT_AUTHENTICATED')
}
function validId(id) { return typeof id === 'string' && /^[A-Za-z0-9]{20}$/.test(id) }
function pathFor(uid, id) { return `activityProofs/${uid}/${id}/proof` }
function reference(draft, uid) {
  if (!draft || !validId(draft.activityId) || draft.studentUid !== uid ||
      typeof draft.attendanceSessionId !== 'string' || !draft.attendanceSessionId || draft.attendanceSessionId.includes('/') ||
      draft.photoPath !== pathFor(uid, draft.activityId)) throw new ActivityError('INVALID_ACTIVITY')
  return doc(db, 'activities', draft.activityId)
}
async function openAttendance(transaction, uid) {
  const profile = (await transaction.get(doc(db, 'users', uid))).data()
  if (!profile || profile.uid !== uid || profile.role !== 'student' || profile.status !== 'approved') {
    throw new ActivityError('NOT_APPROVED_STUDENT')
  }
  const state = (await transaction.get(doc(db, 'attendanceStates', uid))).data()
  if (!state || state.status === 'OUT') throw new ActivityError('NO_OPEN_ATTENDANCE')
  if (state.studentUid !== uid || state.status !== 'IN' || state.timeOut !== null ||
      typeof state.sessionId !== 'string' || !state.sessionId || state.sessionId.includes('/')) {
    throw new ActivityError('ATTENDANCE_INCONSISTENT')
  }
  const session = (await transaction.get(doc(db, 'attendance', state.sessionId))).data()
  if (!session || session.studentUid !== uid || session.studentId !== profile.studentId ||
      typeof profile.studentId !== 'string' || !profile.studentId || session.status !== 'IN' || session.timeOut !== null ||
      timestampNanoseconds(state.timeIn) !== timestampNanoseconds(session.timeIn) ||
      timestampNanoseconds(state.updatedAt) !== timestampNanoseconds(state.timeIn) ||
      timestampNanoseconds(session.updatedAt) !== timestampNanoseconds(session.timeIn)) {
    throw new ActivityError('ATTENDANCE_INCONSISTENT')
  }
  sameUser(uid)
  return { profile, state }
}

// Allocate once before Phase 4A-2 uploads; keep this descriptor for retries.
// No document is written and no Storage object is checked or created here.
export function allocateActivity() {
  return perform(async () => {
    const uid = uidNow()
    const ref = doc(collection(db, 'activities'))
    return runTransaction(db, async transaction => {
      const { state } = await openAttendance(transaction, uid)
      return Object.freeze({ activityId: ref.id, studentUid: uid,
        attendanceSessionId: state.sessionId, photoPath: pathFor(uid, ref.id) })
    })
  })
}
export function createActivity(draft, { category, description } = {}) {
  return perform(async () => {
    const uid = uidNow()
    const ref = reference(draft, uid)
    if (!ACTIVITY_CATEGORIES.includes(category)) throw new ActivityError('INVALID_CATEGORY')
    const text = normalizeActivityDescription(description)
    // Uploads must never run inside this retryable callback.
    await runTransaction(db, async transaction => {
      sameUser(uid)
      const { profile, state } = await openAttendance(transaction, uid)
      if (state.sessionId !== draft.attendanceSessionId) throw new ActivityError('SESSION_CHANGED')
      if ((await transaction.get(ref)).exists()) throw new ActivityError('ALREADY_EXISTS')
      sameUser(uid)
      transaction.set(ref, {
        studentUid: uid, studentId: profile.studentId, attendanceSessionId: draft.attendanceSessionId,
        category, description: text, photoPath: pathFor(uid, ref.id), createdAt: serverTimestamp(),
      })
    })
    return { activityId: ref.id, studentUid: uid }
  })
}
// Reconcile an uncertain commit before retrying. Never delete a proof on an uncertain result.
export function getOwnActivity(activityId) {
  return perform(async () => {
    const uid = uidNow()
    if (!validId(activityId)) throw new ActivityError('INVALID_ACTIVITY')
    const snapshot = await getDocFromServer(doc(db, 'activities', activityId))
    sameUser(uid)
    if (!snapshot.exists()) return null
    if (snapshot.data().studentUid !== uid) throw new ActivityError('PERMISSION_DENIED')
    return { ...snapshot.data(), id: snapshot.id }
  })
}
async function readActivities({ pageSize = 25, after = null, category = null, day = null } = {}, sessionId = null) {
  const uid = uidNow()
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 ||
      (category !== null && !ACTIVITY_CATEGORIES.includes(category)) || (sessionId && category)) {
    throw new ActivityError('INVALID_QUERY')
  }
  let range
  try { range = day === null ? null : activityManilaDayRange(day) } catch { throw new ActivityError('INVALID_QUERY') }
  const constraints = [where('studentUid', '==', uid)]
  if (sessionId) constraints.push(where('attendanceSessionId', '==', sessionId))
  if (category) constraints.push(where('category', '==', category))
  if (range) constraints.push(where('createdAt', '>=', range.start), where('createdAt', '<', range.end))
  if (after) {
    const record = typeof after.data === 'function' ? after.data() : null
    if (!record || !after.ref || !validId(after.id) || !refEqual(after.ref, doc(db, 'activities', after.id)) ||
        record.studentUid !== uid || (category && record.category !== category) ||
        (sessionId && record.attendanceSessionId !== sessionId) ||
        (range && (timestampNanoseconds(record.createdAt) < timestampNanoseconds(range.start) ||
          timestampNanoseconds(record.createdAt) >= timestampNanoseconds(range.end)))) throw new ActivityError('INVALID_QUERY')
  }
  constraints.push(orderBy('createdAt', 'desc'), limit(pageSize))
  if (after) constraints.push(startAfter(after))
  const result = await getDocsFromServer(query(collection(db, 'activities'), ...constraints))
  sameUser(uid)
  const records = result.docs.map(snapshot => {
    const record = snapshot.data()
    if (record.studentUid !== uid) throw new ActivityError('PERMISSION_DENIED')
    return { ...record, id: snapshot.id }
  })
  return { records, lastSnapshot: result.docs.at(-1) ?? null, mayHaveMore: records.length === pageSize }
}
export function getStudentActivities(options) { return perform(() => readActivities(options)) }
export function getRecentActivities() { return getStudentActivities({ pageSize: 3 }) }
export function getTodayActivities(options = {}) {
  return getStudentActivities({ ...options, day: activityManilaDayRange().start })
}
export function getCurrentSessionActivities(options = {}) {
  return perform(async () => {
    const uid = uidNow()
    const { state } = await runTransaction(db, transaction => openAttendance(transaction, uid))
    sameUser(uid)
    return readActivities(options, state.sessionId)
  })
}
