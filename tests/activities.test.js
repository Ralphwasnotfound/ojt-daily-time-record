import test from 'node:test'
import assert from 'node:assert/strict'
import { Timestamp } from 'firebase/firestore'
import { ACTIVITY_CATEGORIES, normalizeActivityDescription, activityManilaDayRange } from '../src/services/activityData.js'

test('description requires trimmed non-whitespace text, preserves newlines, caps size', () => {
  assert.equal(normalizeActivityDescription(' \n Work\nDone\t'), 'Work\nDone')
  assert.equal(normalizeActivityDescription('x'.repeat(500)).length, 500)
  for (const value of [null, 1, '', ' \n\t', '\u00a0\u2003', 'x'.repeat(501)]) {
    assert.throws(() => normalizeActivityDescription(value), /INVALID_DESCRIPTION/)
  }
  assert.equal(ACTIVITY_CATEGORIES.length, 8)
  assert.ok(Object.isFrozen(ACTIVITY_CATEGORIES))
})
test('Manila day bounds cross UTC, month and year boundaries and are end-exclusive', () => {
  for (const [instant, expected] of [
    ['2026-09-28T15:59:59.999Z', '2026-09-27T16:00:00.000Z'],
    ['2026-09-28T16:00:00.000Z', '2026-09-28T16:00:00.000Z'],
    ['2026-12-31T16:00:00.000Z', '2026-12-31T16:00:00.000Z'],
    ['2028-02-29T17:00:00.000Z', '2028-02-29T16:00:00.000Z'],
  ]) {
    const { start, end } = activityManilaDayRange(Timestamp.fromDate(new Date(instant)))
    assert.equal(start.toDate().toISOString(), expected)
    assert.equal(end.seconds - start.seconds, 86400)
  }
  assert.throws(() => activityManilaDayRange({ seconds: NaN }))
})

import { readFile } from 'node:fs/promises'
import { SourceTextModule, SyntheticModule } from 'node:vm'
import * as data from '../src/services/activityData.js'
import * as time from '../src/services/attendanceTime.js'
async function mockedService({ uid = 'alice', role = 'student', status = 'approved', statePatch = {}, sessionPatch = {}, retry = false, failure = null } = {}) {
  const writes = [], queries = [], db = {}, stamp = Timestamp.fromMillis(1000)
  const auth = { currentUser: uid ? { uid } : null }
  const state = { studentUid: 'alice', sessionId: 'session', status: 'IN', timeIn: stamp, timeOut: null, updatedAt: stamp, ...statePatch }
  const session = { ...state, studentId: 'ID-alice', ...sessionPatch }
  const profile = { uid: 'alice', role, status, studentId: 'ID-alice' }
  let allocations = 0
  const snapshot = value => ({ exists: () => value !== undefined, data: () => value })
  const sdk = {
    collection: (db, path) => ({ path }),
    doc(db, ...parts) {
      if (!parts.length) { allocations++; return { id: 'ABCDEFGHIJKLMNOPQRST', path: 'activities/ABCDEFGHIJKLMNOPQRST' } }
      return { id: parts.at(-1), path: parts.join('/') }
    },
    async runTransaction(db, operation) {
      if (failure) throw failure
      const tx = { get: async ref => snapshot(ref.path.startsWith('users/') ? profile : ref.path.startsWith('attendanceStates/') ? state : ref.path.startsWith('attendance/') ? session : undefined),
        set: (ref, value) => writes.push({ ref, value }) }
      if (retry) await operation(tx)
      return operation(tx)
    },
    refEqual: (a, b) => a.path === b.path,
    serverTimestamp: () => ({ serverTransform: true }),
    getDocFromServer: async () => snapshot(undefined),
    getDocsFromServer: async q => { queries.push(q); return { docs: [] } },
    query: (ref, ...constraints) => ({ ref, constraints }),
    where: (...args) => ['where', ...args], orderBy: (...args) => ['orderBy', ...args],
    limit: (...args) => ['limit', ...args], startAfter: (...args) => ['startAfter', ...args],
  }
  const module = new SourceTextModule(await readFile('src/services/activities.js', 'utf8'))
  await module.link(specifier => {
    const values = specifier === 'firebase/firestore' ? sdk : specifier.endsWith('activityData.js') ? data
      : specifier.endsWith('attendanceTime.js') ? time : { db, auth }
    return new SyntheticModule(Object.keys(values), function () { for (const [key,value] of Object.entries(values)) this.setExport(key,value) })
  })
  await module.evaluate()
  return { api: module.namespace, writes, queries, state, auth, allocations: () => allocations }
}
test('allocation is stable across transaction retries; writes use exact schema and server transform', async () => {
  const t = await mockedService({ retry: true }), draft = await t.api.allocateActivity()
  assert.equal(t.allocations(), 1); assert.equal(t.writes.length, 0)
  assert.equal(draft.photoPath, 'activityProofs/alice/ABCDEFGHIJKLMNOPQRST/proof')
  await t.api.createActivity(draft, { category: 'Other', description: ' Work\nDone ' })
  for (const { value, ref } of t.writes) {
    assert.equal(ref.id, draft.activityId)
    assert.deepEqual(Object.keys(value).sort(), ['studentUid','studentId','attendanceSessionId','category','description','photoPath','createdAt'].sort())
    assert.deepEqual(value.createdAt, { serverTransform: true })
    assert.equal(value.description, 'Work\nDone')
  }
})
test('service rejects unauthorized, OUT and inconsistent attendance', async () => {
  for (const [options, code] of [[{ uid: null }, 'NOT_AUTHENTICATED'], [{ status: 'pending' }, 'NOT_APPROVED_STUDENT'],
    [{ role: 'admin' }, 'NOT_APPROVED_STUDENT'], [{ statePatch: { status: 'OUT' } }, 'NO_OPEN_ATTENDANCE'],
    [{ sessionPatch: { studentUid: 'bob' } }, 'ATTENDANCE_INCONSISTENT']]) {
    const t = await mockedService(options)
    await assert.rejects(t.api.allocateActivity(), { code }); assert.equal(t.writes.length, 0)
  }
})
test('finalization rejects invalid reference/form/session and changed account', async () => {
  const t = await mockedService(), draft = await t.api.allocateActivity()
  for (const patch of [{ studentUid: 'bob' }, { photoPath: 'https://example.com' }, { activityId: '../x' }]) {
    await assert.rejects(t.api.createActivity({ ...draft, ...patch }, { category: 'Other', description: 'x' }), { code: 'INVALID_ACTIVITY' })
  }
  await assert.rejects(t.api.createActivity(draft, { category: 'Unknown', description: 'x' }), { code: 'INVALID_CATEGORY' })
  await assert.rejects(t.api.createActivity(draft, { category: 'Other', description: '  ' }), { code: 'INVALID_DESCRIPTION' })
  await assert.rejects(t.api.createActivity({ ...draft, attendanceSessionId: 'previous' }, { category: 'Other', description: 'x' }), { code: 'SESSION_CHANGED' })
  t.auth.currentUser = null
  await assert.rejects(t.api.createActivity(draft, { category: 'Other', description: 'x' }), { code: 'NOT_AUTHENTICATED' })
  assert.equal(t.writes.length, 0)
})
test('queries always include own UID, server-side filters, bounds and bounded limits', async () => {
  const t = await mockedService()
  await t.api.getStudentActivities({ category: 'Other', day: Timestamp.fromMillis(1000), pageSize: 10 })
  await t.api.getCurrentSessionActivities()
  await t.api.getRecentActivities()
  await t.api.getTodayActivities()
  for (const q of t.queries) assert.ok(q.constraints.some(c => JSON.stringify(c) === JSON.stringify(['where','studentUid','==','alice'])))
  assert.ok(t.queries[0].constraints.some(c => c[1] === 'createdAt' && c[2] === '>='))
  assert.ok(t.queries[0].constraints.some(c => c[1] === 'createdAt' && c[2] === '<'))
  assert.ok(t.queries[1].constraints.some(c => c[1] === 'attendanceSessionId' && c[3] === 'session'))
  assert.ok(t.queries[2].constraints.some(c => c[0] === 'limit' && c[1] === 3))
  for (const options of [{ pageSize: 0 }, { pageSize: 101 }, { category: 'unknown' }, { day: {} }, { after: {} }]) {
    await assert.rejects(t.api.getStudentActivities(options), { code: 'INVALID_QUERY' })
  }
})
test('Firebase failures have friendly errors and never produce writes', async () => {
  for (const [original, code] of [['permission-denied','PERMISSION_DENIED'],['unavailable','OFFLINE'],['unauthenticated','NOT_AUTHENTICATED'],['unknown','ACTIVITY_FAILED']]) {
    const t = await mockedService({ failure: { code: original, message: 'Internal details' } })
    await assert.rejects(t.api.allocateActivity(), e => e.code === code && !e.message.includes('Internal details'))
    assert.equal(t.writes.length, 0)
  }
})
