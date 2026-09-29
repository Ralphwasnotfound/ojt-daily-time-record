import {
  collection, doc, getDocFromServer, getDocsFromServer, query, where,
  orderBy, limit, startAfter, runTransaction, serverTimestamp, Timestamp, onSnapshot,
} from 'firebase/firestore'
import { auth, db } from '../firebase/firebase'
import { sameManilaDay, timestampNanoseconds, calculateSessionDuration } from './attendanceTime.js'

const messages = {
  NOT_AUTHENTICATED: 'Sign in before accessing attendance.',
  NOT_APPROVED_STUDENT: 'Attendance requires an approved student account.',
  ALREADY_TIMED_IN: 'You already have an open attendance session.',
  ALREADY_COMPLETED_TODAY: 'You have already started attendance for this Manila calendar day.',
  NO_OPEN_ATTENDANCE: 'There is no open attendance session to close.',
  ATTENDANCE_INCONSISTENT: 'Attendance data needs administrator review. No changes were made.',
  OFFLINE: 'Unable to reach attendance services. Check your connection and refresh before retrying.',
  PERMISSION_DENIED: 'Attendance was not permitted. Refresh your account and attendance status before retrying.',
  ATTENDANCE_FAILED: 'Unable to confirm attendance. Refresh before retrying.',
  INVALID_QUERY: 'The attendance query is invalid.',
}

export class AttendanceError extends Error {
  constructor(code) { super(messages[code]); this.name = 'AttendanceError'; this.code = code }
}

export function mapAttendanceError(error) {
  if (error instanceof AttendanceError) return error
  if (error?.message === 'ATTENDANCE_INCONSISTENT') return new AttendanceError('ATTENDANCE_INCONSISTENT')
  if (['unavailable', 'deadline-exceeded'].includes(error?.code)) return new AttendanceError('OFFLINE')
  if (error?.code === 'permission-denied') return new AttendanceError('PERMISSION_DENIED')
  if (error?.code === 'unauthenticated') return new AttendanceError('NOT_AUTHENTICATED')
  return new AttendanceError('ATTENDANCE_FAILED')
}

async function perform(operation) {
  try { return await operation() } catch (error) { throw mapAttendanceError(error) }
}

function currentUid() {
  if (!auth.currentUser) throw new AttendanceError('NOT_AUTHENTICATED')
  return auth.currentUser.uid
}

function assertSameUser(uid) {
  if (auth.currentUser?.uid !== uid) throw new AttendanceError('NOT_AUTHENTICATED')
}

async function approvedProfile(transaction, uid) {
  const snapshot = await transaction.get(doc(db, 'users', uid))
  const profile = snapshot.data()
  if (!snapshot.exists() || profile.uid !== uid || profile.role !== 'student' || profile.status !== 'approved') {
    throw new AttendanceError('NOT_APPROVED_STUDENT')
  }
  if (typeof profile.studentId !== 'string' || !profile.studentId) throw new AttendanceError('ATTENDANCE_INCONSISTENT')
  return profile
}

function validState(state, uid) {
  if (state.studentUid !== uid || typeof state.sessionId !== 'string' || !state.sessionId || state.sessionId.includes('/')) {
    throw new AttendanceError('ATTENDANCE_INCONSISTENT')
  }
  calculateSessionDuration(state)
  if (timestampNanoseconds(state.updatedAt) !== timestampNanoseconds(state.timeOut ?? state.timeIn)) {
    throw new AttendanceError('ATTENDANCE_INCONSISTENT')
  }
}

function matchingSession(state, session, uid) {
  if (!session || session.studentUid !== uid || session.status !== state.status ||
      timestampNanoseconds(session.timeIn) !== timestampNanoseconds(state.timeIn) ||
      timestampNanoseconds(session.updatedAt) !== timestampNanoseconds(state.updatedAt) ||
      (session.timeOut === null) !== (state.timeOut === null) ||
      (session.timeOut !== null && timestampNanoseconds(session.timeOut) !== timestampNanoseconds(state.timeOut))) {
    throw new AttendanceError('ATTENDANCE_INCONSISTENT')
  }
  calculateSessionDuration(session)
}

export function timeIn() {
  return perform(async () => {
    const uid = currentUid()
    // Allocate once, never inside the retryable callback.
    const sessionRef = doc(collection(db, 'attendance'))
    const stateRef = doc(db, 'attendanceStates', uid)
    await runTransaction(db, async transaction => {
      assertSameUser(uid)
      const profile = await approvedProfile(transaction, uid)
      const snapshot = await transaction.get(stateRef)
      if (snapshot.exists()) {
        const state = snapshot.data()
        validState(state, uid)
        if (state.status === 'IN') throw new AttendanceError('ALREADY_TIMED_IN')
        const previous = await transaction.get(doc(db, 'attendance', state.sessionId))
        matchingSession(state, previous.data(), uid)
        // Friendly preflight only. Device time never goes into a write or grants access:
        // rules independently compare the previous trusted timeIn against request.time.
        if (sameManilaDay(state.timeIn, Timestamp.now())) throw new AttendanceError('ALREADY_COMPLETED_TODAY')
      }
      assertSameUser(uid)
      const stamp = serverTimestamp()
      transaction.set(sessionRef, {
        studentUid: uid, studentId: profile.studentId, status: 'IN',
        timeIn: stamp, timeOut: null, createdAt: stamp, updatedAt: stamp,
      })
      transaction.set(stateRef, {
        studentUid: uid, sessionId: sessionRef.id, status: 'IN',
        timeIn: stamp, timeOut: null, updatedAt: stamp,
      })
    })
    return { sessionId: sessionRef.id, studentUid: uid }
  })
}

export function timeOut() {
  return perform(async () => {
    const uid = currentUid()
    const stateRef = doc(db, 'attendanceStates', uid)
    return runTransaction(db, async transaction => {
      assertSameUser(uid)
      await approvedProfile(transaction, uid)
      const snapshot = await transaction.get(stateRef)
      if (!snapshot.exists()) throw new AttendanceError('NO_OPEN_ATTENDANCE')
      const state = snapshot.data()
      validState(state, uid)
      if (state.status !== 'IN') throw new AttendanceError('NO_OPEN_ATTENDANCE')
      const sessionRef = doc(db, 'attendance', state.sessionId)
      const session = await transaction.get(sessionRef)
      matchingSession(state, session.data(), uid)
      assertSameUser(uid)
      const patch = { status: 'OUT', timeOut: serverTimestamp(), updatedAt: serverTimestamp() }
      transaction.update(sessionRef, patch)
      transaction.update(stateRef, patch)
      return { sessionId: sessionRef.id, studentUid: uid }
    })
  })
}

export function getAttendanceState() {
  return perform(async () => {
    const uid = currentUid()
    const snapshot = await getDocFromServer(doc(db, 'attendanceStates', uid))
    assertSameUser(uid)
    if (!snapshot.exists()) return null
    validState(snapshot.data(), uid)
    return snapshot.data()
  })
}

// Returns both data and a DocumentSnapshot cursor. No caller-supplied student UID.
async function readAttendance(completed, { pageSize = 25, after = null } = {}) {
  const uid = currentUid()
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new AttendanceError('INVALID_QUERY')
  if (after && (typeof after.data !== 'function' || after.data()?.studentUid !== uid)) throw new AttendanceError('INVALID_QUERY')
  const constraints = [where('studentUid', '==', uid)]
  if (completed) constraints.push(where('status', '==', 'OUT'))
  constraints.push(orderBy('timeIn', 'desc'), limit(pageSize))
  if (after) constraints.push(startAfter(after))
  const snapshot = await getDocsFromServer(query(collection(db, 'attendance'), ...constraints))
  assertSameUser(uid)
  const records = snapshot.docs.map(item => {
    const record = item.data()
    if (record.studentUid !== uid) throw new AttendanceError('ATTENDANCE_INCONSISTENT')
    calculateSessionDuration(record)
    return { ...record, id: item.id }
  })
  return { records, lastSnapshot: snapshot.docs.at(-1) ?? null, mayHaveMore: records.length === pageSize }
}

export function getStudentAttendance(options) { return perform(() => readAttendance(false, options)) }
export function getCompletedAttendance(options) { return perform(() => readAttendance(true, options)) }

// Never present cached/local pending snapshots as confirmed attendance.
export function watchAttendanceState(onState, onError, onUnconfirmed = () => {}) {
  const uid = currentUid()
  return onSnapshot(doc(db, 'attendanceStates', uid), { includeMetadataChanges: true }, snapshot => {
    try {
      assertSameUser(uid)
      if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) {
        onUnconfirmed()
        return
      }
      const state = snapshot.exists() ? snapshot.data() : null
      if (state) validState(state, uid)
      onState(state)
    } catch (error) { onError(mapAttendanceError(error)) }
  }, error => onError(mapAttendanceError(error)))
}

// Load every page before exposing totals. Cancellation discards obsolete route/account loads.
export function getAllStudentAttendance(isCurrent = () => true) {
  return perform(async () => {
    const uid = currentUid()
    const records = []
    const ids = new Set()
    let after = null
    do {
      assertSameUser(uid)
      if (!isCurrent()) return null
      const page = await getStudentAttendance({ pageSize: 100, after })
      assertSameUser(uid)
      if (!isCurrent()) return null
      for (const record of page.records) {
        if (ids.has(record.id)) throw new AttendanceError('ATTENDANCE_INCONSISTENT')
        ids.add(record.id)
        records.push(record)
      }
      if (!page.mayHaveMore) return records
      if (!page.lastSnapshot) throw new AttendanceError('ATTENDANCE_INCONSISTENT')
      after = page.lastSnapshot
    } while (true)
  })
}
