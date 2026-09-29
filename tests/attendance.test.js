import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { SourceTextModule, SyntheticModule } from 'node:vm'
import { Timestamp } from 'firebase/firestore'
import * as time from '../src/services/attendanceTime.js'

async function service({ uid = 'alice', profile, state = null, session = null, error, retry = false, pages = [], listener } = {}) {
  const writes = [], queries = []
  let allocated = 0
  const snapshot = data => ({ exists: () => data !== null, data: () => data })
  const student = profile ?? { uid: 'alice', role: 'student', status: 'approved', studentId: 'ID-alice' }
  const transaction = {
    async get(ref) {
      if (ref.path.startsWith('users/')) return snapshot(student)
      if (ref.path.startsWith('attendanceStates/')) return snapshot(state)
      return snapshot(session)
    },
    set(ref, value) { writes.push(['set', ref, value]) },
    update(ref, value) { writes.push(['update', ref, value]) },
  }
  const sdk = {
    Timestamp,
    collection(db, path) { return { path } },
    doc(db, ...parts) {
      if (!parts.length) { allocated++; return { path: `attendance/auto-${allocated}`, id: `auto-${allocated}` } }
      return { path: parts.join('/'), id: parts.at(-1) }
    },
    async runTransaction(db, callback) {
      if (error) throw error
      if (retry) await callback(transaction)
      return callback(transaction)
    },
    serverTimestamp: () => ({ transform: 'serverTimestamp' }),
    getDocFromServer: async () => snapshot(state),
    getDocsFromServer: async q => { queries.push(q); return { docs: pages.shift() ?? [] } },
    onSnapshot: (...args) => listener?.(...args) ?? (() => {}),
    query: (ref, ...constraints) => ({ ref, constraints }),
    where: (...args) => ['where', ...args], orderBy: (...args) => ['orderBy', ...args],
    limit: value => ['limit', value], startAfter: value => ['startAfter', value],
  }
  const auth = { currentUser: uid ? { uid } : null }
  const module = new SourceTextModule(await readFile('src/services/attendance.js', 'utf8'))
  await module.link(specifier => {
    const exports = specifier === 'firebase/firestore' ? sdk : specifier.endsWith('attendanceTime.js') ? time : { auth, db: {} }
    return new SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value) })
  })
  await module.evaluate()
  return { api: module.namespace, writes, queries, allocated: () => allocated }
}
test('Time In retries reuse one ID and write only server timestamp transforms', async () => {
  const { api, writes, allocated } = await service({ retry: true })
  const result = await api.timeIn()
  assert.equal(allocated(), 1)
  assert.equal(result.sessionId, 'auto-1')
  for (const [, , value] of writes) {
    assert.deepEqual(value.timeIn, { transform: 'serverTimestamp' })
    assert.equal(value.studentUid, 'alice')
    assert.equal(value.timeOut, null)
    assert.equal(value.status, 'IN')
  }
  assert.equal(writes[0][2].studentId, 'ID-alice')
})
test('service denies anonymous and non-approved users before writing', async () => {
  for (const options of [{ uid: null }, { profile: { uid: 'alice', role: 'student', status: 'pending' } }, { profile: { uid: 'alice', role: 'admin', status: 'approved' } }]) {
    const { api, writes } = await service(options)
    await assert.rejects(api.timeIn(), error => ['NOT_AUTHENTICATED', 'NOT_APPROVED_STUDENT'].includes(error.code))
    assert.equal(writes.length, 0)
  }
})
const start = Timestamp.fromMillis(Date.now() - 1000)
const openState = { studentUid: 'alice', sessionId: 'existing', status: 'IN', timeIn: start, timeOut: null, updatedAt: start }
test('Time Out patches only allowed fields and preserves state document', async () => {
  const { api, writes } = await service({ state: openState, session: { ...openState, studentId: 'ID-alice', createdAt: start } })
  await api.timeOut()
  assert.equal(writes.length, 2)
  for (const [method, , patch] of writes) {
    assert.equal(method, 'update')
    assert.deepEqual(Object.keys(patch).sort(), ['status', 'timeOut', 'updatedAt'])
    assert.equal(patch.status, 'OUT')
    assert.deepEqual(patch.timeOut, { transform: 'serverTimestamp' })
  }
})
test('open, same-day completed, missing, and inconsistent states have safe errors', async () => {
  const opened = await service({ state: openState })
  await assert.rejects(opened.api.timeIn(), { code: 'ALREADY_TIMED_IN' })
  const closed = { ...openState, status: 'OUT', timeOut: start }
  const completed = await service({ state: closed, session: closed })
  await assert.rejects(completed.api.timeIn(), { code: 'ALREADY_COMPLETED_TODAY' })
  await assert.rejects(completed.api.timeOut(), { code: 'NO_OPEN_ATTENDANCE' })
  const missing = await service()
  await assert.rejects(missing.api.timeOut(), { code: 'NO_OPEN_ATTENDANCE' })
  const inconsistent = await service({ state: openState, session: { ...openState, studentUid: 'bob' } })
  await assert.rejects(inconsistent.api.timeOut(), { code: 'ATTENDANCE_INCONSISTENT' })
})
test('all history queries constrain the authenticated UID and provide bounded pagination', async () => {
  const { api, queries } = await service()
  await api.getStudentAttendance()
  await api.getCompletedAttendance({ pageSize: 50 })
  for (const q of queries) assert.deepEqual(q.constraints[0], ['where', 'studentUid', '==', 'alice'])
  assert.deepEqual(queries[1].constraints[1], ['where', 'status', '==', 'OUT'])
  await assert.rejects(api.getStudentAttendance({ pageSize: 0 }), { code: 'INVALID_QUERY' })
  await assert.rejects(api.getStudentAttendance({ after: { data: () => ({ studentUid: 'bob' }) } }), { code: 'INVALID_QUERY' })
})
test('Firebase errors are mapped without exposing raw details', async () => {
  for (const [code, expected] of [['permission-denied', 'PERMISSION_DENIED'], ['unavailable', 'OFFLINE'], ['unauthenticated', 'NOT_AUTHENTICATED'], ['aborted', 'ATTENDANCE_FAILED']]) {
    const { api } = await service({ error: { code, message: 'raw private details' } })
    await assert.rejects(api.timeIn(), error => error.code === expected && !error.message.includes('raw private'))
  }
})

test('all-history loader traverses every page and retains records for full totals', async () => {
  const record = (id, status = 'OUT') => ({ id, data: () => ({ studentUid: 'alice', status, timeIn: new Timestamp(0, 0), timeOut: status === 'OUT' ? new Timestamp(3600, 0) : null }) })
  const pages = [Array.from({ length: 100 }, (_, i) => record(String(i))), [record('last'), record('open', 'IN')]]
  const { api, queries } = await service({ pages })
  const records = await api.getAllStudentAttendance()
  assert.equal(records.length, 102)
  assert.equal(time.calculateTotalCompletedDuration(records), 101n * 3600000000000n)
  assert.equal(queries.length, 2)
  assert.equal(queries[1].constraints.at(-1)[0], 'startAfter')
})

test('listener does not confirm cached or pending states and returns cleanup', async () => {
  let next, stopped = false, confirmed = 0, unconfirmed = 0
  const { api } = await service({ listener: (ref, options, callback) => {
    assert.equal(ref.path, 'attendanceStates/alice')
    assert.equal(options.includeMetadataChanges, true)
    next = callback
    return () => { stopped = true }
  } })
  const stop = api.watchAttendanceState(() => confirmed++, error => { throw error }, () => unconfirmed++)
  next({ metadata: { fromCache: true, hasPendingWrites: false } })
  next({ metadata: { fromCache: false, hasPendingWrites: true } })
  assert.equal(confirmed, 0)
  next({ metadata: { fromCache: false, hasPendingWrites: false }, exists: () => false })
  assert.equal(confirmed, 1)
  assert.equal(unconfirmed, 2)
  stop()
  assert.equal(stopped, true)
})
