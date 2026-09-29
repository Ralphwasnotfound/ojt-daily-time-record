import { before, after, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { SourceTextModule, SyntheticModule } from 'node:vm'
import * as firestoreSdk from 'firebase/firestore'
import * as timeUtilities from '../src/services/attendanceTime.js'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import {
  doc, setDoc, getDoc, getDocs, collection, query, where, updateDoc, deleteDoc,
  writeBatch, serverTimestamp, Timestamp, setLogLevel,
} from 'firebase/firestore'

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run through npm run test:rules; a local Firestore emulator is required.')
const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':')
if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error('Tests require a loopback emulator.')
let env
setLogLevel('silent')
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-ojt-attendance',
    firestore: { host, port: Number(port), rules: await readFile('firestore.rules', 'utf8') },
  })
})
after(async () => { await env?.cleanup() })
beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async context => {
    for (const [uid, role, status] of [
      ['alice', 'student', 'approved'], ['bob', 'student', 'approved'],
      ['pending', 'student', 'pending'], ['rejected', 'student', 'rejected'], ['admin', 'admin', 'approved'],
    ]) await setDoc(doc(context.firestore(), 'users', uid), { uid, role, status, studentId: `ID-${uid}` })
  })
})
const dbFor = uid => uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore()
function start(db, uid = 'alice', id = 'session', patch = {}, statePatch = {}) {
  const batch = writeBatch(db)
  const stamp = serverTimestamp()
  const session = { studentUid: uid, studentId: `ID-${uid}`, status: 'IN', timeIn: stamp, timeOut: null, createdAt: stamp, updatedAt: stamp, ...patch }
  const state = { studentUid: uid, sessionId: id, status: 'IN', timeIn: stamp, timeOut: null, updatedAt: stamp, ...statePatch }
  batch.set(doc(db, 'attendance', id), session)
  batch.set(doc(db, 'attendanceStates', uid), state)
  return batch.commit()
}
function close(db, uid = 'alice', id = 'session', patch = {}) {
  const batch = writeBatch(db)
  const update = { status: 'OUT', timeOut: serverTimestamp(), updatedAt: serverTimestamp(), ...patch }
  batch.update(doc(db, 'attendance', id), update)
  batch.update(doc(db, 'attendanceStates', uid), update)
  return batch.commit()
}
async function seedSession({ uid = 'alice', id = 'session', status = 'IN', timeIn = Timestamp.fromMillis(Date.now() - 86400000) } = {}) {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    const timeOut = status === 'OUT' ? Timestamp.fromMillis(timeIn.toMillis() + 1000) : null
    const updatedAt = timeOut ?? timeIn
    await setDoc(doc(db, 'attendance', id), { studentUid: uid, studentId: `ID-${uid}`, status, timeIn, timeOut, createdAt: timeIn, updatedAt })
    await setDoc(doc(db, 'attendanceStates', uid), { studentUid: uid, sessionId: id, status, timeIn, timeOut, updatedAt })
  })
}

test('approved student creates atomic session/state with equal server timestamps', async () => {
  const db = dbFor('alice')
  await assertSucceeds(getDoc(doc(db, 'attendanceStates', 'alice')))
  await assertSucceeds(start(db))
  const session = (await getDoc(doc(db, 'attendance', 'session'))).data()
  const state = (await getDoc(doc(db, 'attendanceStates', 'alice'))).data()
  assert.ok(session.timeIn instanceof Timestamp)
  assert.ok(session.timeIn.isEqual(session.createdAt))
  assert.ok(session.timeIn.isEqual(state.timeIn))
})
for (const uid of [null, 'pending', 'rejected', 'admin', 'unknown']) {
  test(`${uid ?? 'anonymous'} cannot Time In`, async () => { await assertFails(start(dbFor(uid), uid ?? 'alice')) })
}
test('forged UID and Student ID denied', async () => {
  await assertFails(start(dbFor('alice'), 'bob'))
  await assertFails(start(dbFor('alice'), 'alice', 'session', { studentId: 'FORGED' }))
})
test('arbitrary timeIn, createdAt, updatedAt and extra fields denied', async () => {
  for (const key of ['timeIn', 'createdAt', 'updatedAt']) {
    await assertFails(start(dbFor('alice'), 'alice', 'session', { [key]: Timestamp.fromMillis(0) }))
  }
  await assertFails(start(dbFor('alice'), 'alice', 'session', { totalHours: 300 }))
  await assertFails(start(dbFor('alice'), 'alice', 'session', {}, { extra: true }))
})
test('concurrent starts result in exactly one committed session', async () => {
  const results = await Promise.allSettled([start(dbFor('alice'), 'alice', 'one'), start(dbFor('alice'), 'alice', 'two')])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  const sessions = await getDocs(query(collection(dbFor('alice'), 'attendance'), where('studentUid', '==', 'alice')))
  assert.equal(sessions.size, 1)
})
test('malicious batch cannot create two sessions referencing one state', async () => {
  const db = dbFor('alice'), batch = writeBatch(db), stamp = serverTimestamp()
  for (const id of ['one', 'two']) batch.set(doc(db, 'attendance', id), { studentUid: 'alice', studentId: 'ID-alice', status: 'IN', timeIn: stamp, timeOut: null, createdAt: stamp, updatedAt: stamp })
  batch.set(doc(db, 'attendanceStates', 'alice'), { studentUid: 'alice', sessionId: 'one', status: 'IN', timeIn: stamp, timeOut: null, updatedAt: stamp })
  await assertFails(batch.commit())
})
test('standalone session creation and standalone state creation denied', async () => {
  const db = dbFor('alice'), stamp = serverTimestamp()
  await assertFails(setDoc(doc(db, 'attendance', 'alone'), { studentUid: 'alice', studentId: 'ID-alice', status: 'IN', timeIn: stamp, timeOut: null, createdAt: stamp, updatedAt: stamp }))
  await assertFails(setDoc(doc(db, 'attendanceStates', 'alice'), { studentUid: 'alice', sessionId: 'alone', status: 'IN', timeIn: stamp, timeOut: null, updatedAt: stamp }))
})
test('valid Time Out preserves Time In and permanent state; repeated Time Out denied', async () => {
  const db = dbFor('alice')
  await start(db)
  const old = (await getDoc(doc(db, 'attendance', 'session'))).data()
  await assertSucceeds(close(db))
  const closed = (await getDoc(doc(db, 'attendance', 'session'))).data()
  assert.ok(closed.timeIn.isEqual(old.timeIn))
  assert.ok(closed.timeOut.isEqual(closed.updatedAt))
  assert.ok((await getDoc(doc(db, 'attendanceStates', 'alice'))).exists())
  await assertFails(close(db))
  assert.ok((await getDoc(doc(db, 'attendance', 'session'))).data().timeOut.isEqual(closed.timeOut))
})
test('second start after same-day close denied', async () => {
  const db = dbFor('alice')
  await start(db)
  await close(db)
  await assertFails(start(db, 'alice', 'second'))
})
test('previous-day closed session permits start; overnight open session does not', async () => {
  await seedSession({ status: 'OUT' })
  await assertSucceeds(start(dbFor('alice'), 'alice', 'today'))
  await seedSession({ uid: 'bob', id: 'overnight' })
  await assertFails(start(dbFor('bob'), 'bob', 'today-bob'))
  await assertSucceeds(close(dbFor('bob'), 'bob', 'overnight'))
})
test('Time Out without open state and session denied', async () => {
  await assertFails(close(dbFor('alice')))
  await seedSession()
  await env.withSecurityRulesDisabled(context => deleteDoc(doc(context.firestore(), 'attendanceStates', 'alice')))
  await assertFails(updateDoc(doc(dbFor('alice'), 'attendance', 'session'), { status: 'OUT', timeOut: serverTimestamp(), updatedAt: serverTimestamp() }))
})
test('standalone close, fake close time and Time In modification denied', async () => {
  await start(dbFor('alice'))
  const db = dbFor('alice'), patch = { status: 'OUT', timeOut: serverTimestamp(), updatedAt: serverTimestamp() }
  await assertFails(updateDoc(doc(db, 'attendance', 'session'), patch))
  await assertFails(updateDoc(doc(db, 'attendanceStates', 'alice'), patch))
  await assertFails(close(db, 'alice', 'session', { timeOut: Timestamp.fromMillis(0) }))
  await assertFails(close(db, 'alice', 'session', { timeIn: serverTimestamp() }))
})
test('closed records cannot be edited/reopened/deleted; state cannot be reset/deleted', async () => {
  const db = dbFor('alice')
  await start(db); await close(db)
  for (const path of ['attendance/session', 'attendanceStates/alice']) {
    await assertFails(updateDoc(doc(db, path), { status: 'IN', timeOut: null }))
    await assertFails(updateDoc(doc(db, path), { timeIn: serverTimestamp() }))
    await assertFails(deleteDoc(doc(db, path)))
  }
})
test('approved admin reads but cannot close attendance; students cannot read others', async () => {
  await start(dbFor('alice'))
  for (const path of ['attendance/session', 'attendanceStates/alice']) {
    await assertSucceeds(getDoc(doc(dbFor('admin'), path)))
    for (const uid of ['bob', 'pending', 'rejected', null]) await assertFails(getDoc(doc(dbFor(uid), path)))
  }
  await assertFails(getDocs(collection(dbFor('alice'), 'attendance')))
  await assertSucceeds(getDocs(query(collection(dbFor('alice'), 'attendance'), where('studentUid', '==', 'alice'))))
  await assertFails(close(dbFor('admin')))
})
test('revoked approval prevents closing an existing open session', async () => {
  await start(dbFor('alice'))
  await env.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'users', 'alice'), { status: 'rejected' }))
  await assertFails(close(dbFor('alice')))
})
test('mismatched pointer and mutated state identity are rejected', async () => {
  await assertFails(start(dbFor('alice'), 'alice', 'session', {}, { sessionId: 'different' }))
  await assertFails(start(dbFor('alice'), 'alice', 'session', {}, { studentUid: 'bob' }))
})

test('real attendance service transactions and paged reads work against the emulator', async () => {
  const module = new SourceTextModule(await readFile('src/services/attendance.js', 'utf8'))
  await module.link(specifier => {
    const exports = specifier === 'firebase/firestore' ? firestoreSdk
      : specifier.endsWith('attendanceTime.js') ? timeUtilities
      : { auth: { currentUser: { uid: 'alice' } }, db: dbFor('alice') }
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
    })
  })
  await module.evaluate()
  const service = module.namespace
  assert.equal(await service.getAttendanceState(), null)
  const started = await service.timeIn()
  assert.equal((await service.getAttendanceState()).sessionId, started.sessionId)
  let stopListener
  const liveState = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Attendance listener did not confirm state')), 10000)
    stopListener = service.watchAttendanceState(state => { clearTimeout(timeout); resolve(state) }, error => { clearTimeout(timeout); reject(error) })
  })
  stopListener()
  assert.equal(liveState.status, 'IN')
  await assert.rejects(service.timeIn(), { code: 'ALREADY_TIMED_IN' })
  await service.timeOut()
  await assert.rejects(service.timeOut(), { code: 'NO_OPEN_ATTENDANCE' })
  await assert.rejects(service.timeIn(), { code: 'ALREADY_COMPLETED_TODAY' })
  const completed = await service.getCompletedAttendance({ pageSize: 1 })
  assert.equal(completed.records.length, 1)
  assert.equal(completed.records[0].status, 'OUT')
  assert.equal((await service.getAllStudentAttendance()).length, 1)
  assert.equal((await service.getStudentAttendance({ after: completed.lastSnapshot })).records.length, 0)
})

test('Manila helper runs in Rules at midnight and month/year boundaries', async () => {
  // A separate demo project exposes only a read-only test probe for the exact helper.
  // It does not replace request.time, and does not modify the production rules file.
  const rules = await readFile('firestore.rules', 'utf8')
  const probes = `match /dayProbes/{id} { allow get: if
    manilaDay(timestamp.date(2026, 9, 29) + duration.value(57599, 's')) == timestamp.date(2026, 9, 29)
    && manilaDay(timestamp.date(2026, 9, 29) + duration.value(57600, 's')) == timestamp.date(2026, 9, 30)
    && manilaDay(timestamp.date(2026, 9, 30) + duration.value(57600, 's')) == timestamp.date(2026, 10, 1)
    && manilaDay(timestamp.date(2026, 12, 31) + duration.value(57600, 's')) == timestamp.date(2027, 1, 1);
  }`
  const probe = await initializeTestEnvironment({ projectId: 'demo-ojt-day-probes', firestore: {
    host, port: Number(port), rules: rules.replace('match /{document=**}', `${probes}\n    match /{document=**}`),
  } })
  try { await assertSucceeds(getDoc(doc(probe.unauthenticatedContext().firestore(), 'dayProbes', 'boundary'))) }
  finally { await probe.cleanup() }
})
