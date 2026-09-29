import { before, after, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { SourceTextModule, SyntheticModule } from 'node:vm'
import * as sdk from 'firebase/firestore'
import * as activityData from '../src/services/activityData.js'
import * as time from '../src/services/attendanceTime.js'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
const { doc, setDoc, getDoc, getDocs, collection, query, where, updateDoc, deleteDoc, writeBatch, serverTimestamp, Timestamp } = sdk
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('A local emulator is required.')
const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':')
if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error('Loopback emulator required.')
let env
const id = 'ABCDEFGHIJKLMNOPQRST'
const dbFor = uid => uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore()
before(async () => {
  sdk.setLogLevel('silent')
  env = await initializeTestEnvironment({ projectId: 'demo-ojt-activities',
    firestore: { host, port: Number(port), rules: await readFile('firestore.rules', 'utf8') } })
})
after(async () => env?.cleanup())
async function seed(path, patch) {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), path), patch, { merge: true }))
}
beforeEach(async () => {
  await env.clearFirestore()
  const stamp = Timestamp.fromMillis(Date.now() - 60000)
  for (const [uid, role, status] of [['alice','student','approved'],['bob','student','approved'],
    ['pending','student','pending'],['rejected','student','rejected'],['admin','admin','approved']]) {
    await seed(`users/${uid}`, { uid, role, status, studentId: `ID-${uid}` })
    await seed(`attendance/${uid}-session`, { studentUid: uid, studentId: `ID-${uid}`, status: 'IN',
      timeIn: stamp, timeOut: null, createdAt: stamp, updatedAt: stamp })
    await seed(`attendanceStates/${uid}`, { studentUid: uid, sessionId: `${uid}-session`, status: 'IN',
      timeIn: stamp, timeOut: null, updatedAt: stamp })
  }
})
function payload(uid = 'alice', activityId = id) {
  return { studentUid: uid, studentId: `ID-${uid}`, attendanceSessionId: `${uid}-session`,
    category: 'Programming / Development', description: 'Fixed layout.\nUpdated documentation.',
    photoPath: `activityProofs/${uid}/${activityId}/proof`, createdAt: serverTimestamp() }
}
function create(uid = 'alice', patch = {}) { return setDoc(doc(dbFor(uid), 'activities', id), { ...payload(uid), ...patch }) }
test('multiple activities, canonical paths, server timestamps, owner/admin reads and immutable records', async () => {
  for (let i = 0; i < activityData.ACTIVITY_CATEGORIES.length; i++) {
    const activityId = doc(collection(dbFor('alice'), 'activities')).id
    await assertSucceeds(setDoc(doc(dbFor('alice'), 'activities', activityId), {
      ...payload('alice', activityId), category: activityData.ACTIVITY_CATEGORIES[i],
    }))
    const snapshot = await assertSucceeds(getDoc(doc(dbFor('alice'), 'activities', activityId)))
    assert.ok(snapshot.data().createdAt instanceof Timestamp)
    await assertSucceeds(getDoc(doc(dbFor('admin'), 'activities', activityId)))
    await assertFails(getDoc(doc(dbFor('bob'), 'activities', activityId)))
  }
})
for (const uid of [null, 'pending', 'rejected', 'admin']) test(`${uid ?? 'anonymous'} cannot create`, async () => {
  await assertFails(create(uid))
})
const invalid = {
  'forged UID': { studentUid: 'bob' }, 'forged student ID': { studentId: 'wrong' },
  'missing session': { attendanceSessionId: 'missing' }, 'other session': { attendanceSessionId: 'bob-session' },
  'slash session': { attendanceSessionId: '../session' }, 'backdate': { createdAt: Timestamp.fromMillis(1) },
  'timestamp type': { createdAt: 'now' }, 'category': { category: 'Programming' },
  'empty': { description: '' }, 'whitespace': { description: ' \n\t ' },
  'unicode whitespace': { description: '\u00a0\u2003' }, 'untrimmed': { description: ' x ' },
  'vertical whitespace': { description: '\u000b' },
  'unicode untrimmed': { description: '\u00a0task\u2003' },
  'long': { description: 'x'.repeat(501) }, 'description type': { description: 1 },
  'path': { photoPath: 'other/path' }, 'URL': { photoPath: 'https://example.com/photo' },
  'other owner path': { photoPath: `activityProofs/bob/${id}/proof` },
  'other activity path': { photoPath: 'activityProofs/alice/ZYXWVUTSRQPONMLKJIHG/proof' },
  'extra field': { hasPhoto: true },
}
for (const [name, patch] of Object.entries(invalid)) test(`reject ${name}`, async () => assertFails(create('alice', patch)))
for (const key of Object.keys(payload())) test(`reject missing ${key}`, async () => {
  const data = payload(); delete data[key]
  await assertFails(setDoc(doc(dbFor('alice'), 'activities', id), data))
})
for (const [name, path, patch] of [
  ['OUT state', 'attendanceStates/alice', { status: 'OUT', timeOut: Timestamp.now() }],
  ['closed session', 'attendance/alice-session', { status: 'OUT', timeOut: Timestamp.now() }],
  ['mismatched pointer', 'attendanceStates/alice', { sessionId: 'bob-session' }],
  ['forged session owner', 'attendance/alice-session', { studentUid: 'bob' }],
  ['inconsistent time', 'attendanceStates/alice', { timeIn: Timestamp.fromMillis(1) }],
  ['session timeout', 'attendance/alice-session', { timeOut: Timestamp.now() }],
]) test(`reject ${name}`, async () => { await seed(path, patch); await assertFails(create()) })
test('student/admin cannot update or delete; queries constrain ownership', async () => {
  await create()
  for (const uid of ['alice','admin']) {
    await assertFails(updateDoc(doc(dbFor(uid), 'activities', id), { description: 'Changed' }))
    await assertFails(deleteDoc(doc(dbFor(uid), 'activities', id)))
  }
  await assertSucceeds(getDocs(query(collection(dbFor('alice'), 'activities'), where('studentUid', '==', 'alice'))))
  await assertFails(getDocs(collection(dbFor('alice'), 'activities')))
  await assertSucceeds(getDocs(collection(dbFor('admin'), 'activities')))
})
test('combined Time Out and activity create rejected atomically', async () => {
  const db = dbFor('alice'), batch = writeBatch(db)
  const close = { status: 'OUT', timeOut: serverTimestamp(), updatedAt: serverTimestamp() }
  batch.update(doc(db, 'attendance', 'alice-session'), close)
  batch.update(doc(db, 'attendanceStates', 'alice'), close)
  batch.set(doc(db, 'activities', id), payload())
  await assertFails(batch.commit())
  assert.equal((await getDoc(doc(db, 'attendanceStates', 'alice'))).data().status, 'IN')
})
test('Time Out after allocation rejects final creation; no attendance mutation', async () => {
  const api = await service(dbFor('alice'))
  const draft = await api.allocateActivity()
  const db = dbFor('alice'), batch = writeBatch(db)
  const close = { status: 'OUT', timeOut: serverTimestamp(), updatedAt: serverTimestamp() }
  batch.update(doc(db, 'attendance', 'alice-session'), close)
  batch.update(doc(db, 'attendanceStates', 'alice'), close)
  await batch.commit()
  await assert.rejects(api.createActivity(draft, { category: 'Other', description: 'Task' }), { code: 'NO_OPEN_ATTENDANCE' })
  assert.equal(await api.getOwnActivity(draft.activityId), null)
})
async function service(db) {
  const module = new SourceTextModule(await readFile('src/services/activities.js', 'utf8'))
  await module.link(specifier => {
    const values = specifier === 'firebase/firestore' ? sdk : specifier.endsWith('activityData.js') ? activityData
      : specifier.endsWith('attendanceTime.js') ? time : { db, auth: { currentUser: { uid: 'alice' } } }
    return new SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value) })
  })
  await module.evaluate(); return module.namespace
}
test('real service allocates, trims, prevents overwrite and pages/query filters through emulator', async () => {
  const api = await service(dbFor('alice'))
  for (const category of ['Other', 'Documentation', 'Other', 'Other']) {
    const draft = await api.allocateActivity()
    assert.match(draft.activityId, /^[A-Za-z0-9]{20}$/)
    assert.equal(await api.getOwnActivity(draft.activityId), null)
    await api.createActivity(draft, { category, description: '  Work\nDone  ' })
    assert.equal((await api.getOwnActivity(draft.activityId)).description, 'Work\nDone')
    await assert.rejects(api.createActivity(draft, { category, description: 'Different' }), { code: 'ALREADY_EXISTS' })
  }
  const first = await api.getStudentActivities({ pageSize: 2 })
  const second = await api.getStudentActivities({ pageSize: 2, after: first.lastSnapshot })
  assert.equal(new Set([...first.records, ...second.records].map(r => r.id)).size, 4)
  assert.equal((await api.getStudentActivities({ category: 'Other' })).records.length, 3)
  assert.equal((await api.getCurrentSessionActivities()).records.length, 4)
  assert.equal((await api.getTodayActivities()).records.length, 4)
  assert.equal((await api.getRecentActivities()).records.length, 3)
  const other = await api.getStudentActivities({ category: 'Other' })
  await assert.rejects(api.getStudentActivities({ category: 'Documentation', after: other.lastSnapshot }), { code: 'INVALID_QUERY' })
})
