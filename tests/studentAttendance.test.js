import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { SourceTextModule, SyntheticModule } from 'node:vm'
import { Timestamp } from 'firebase/firestore'
import * as presentation from '../src/services/attendancePresentation.js'

const now = Timestamp.fromDate(new Date('2026-09-29T08:00:00Z'))
const start = Timestamp.fromDate(new Date('2026-09-29T00:03:00Z'))
const opened = { studentUid: 'alice', sessionId: 'session', status: 'IN', timeIn: start, timeOut: null, updatedAt: start }
const closed = { ...opened, status: 'OUT', timeOut: now, updatedAt: now }
const profile = { fullName: 'Real Student', requiredHours: 486 }
const recordsFor = state => state ? [{ ...state, id: state.sessionId }] : []
const settle = () => new Promise(resolve => setImmediate(resolve))
async function setup({ initial = null, actionError = null, delayed = false, historyError = false } = {}) {
  let state = initial, next, fail, unconfirmed, release, readRelease
  let writes = 0, unsubscribed = 0
  const sdk = {
    watchAttendanceState(onState, onError, onUnconfirmed) {
      next = onState; fail = onError; unconfirmed = onUnconfirmed
      queueMicrotask(() => onState(state))
      return () => { unsubscribed++ }
    },
    async getAttendanceState() { return state },
    async getAllStudentAttendance(isCurrent) {
      if (historyError) throw Error('ATTENDANCE_INCONSISTENT')
      if (readRelease) await readRelease
      return isCurrent() ? recordsFor(state) : null
    },
    async timeIn() {
      writes++
      if (delayed) await new Promise(resolve => { release = resolve })
      if (actionError) throw actionError
      state = opened
      return { sessionId: 'session' }
    },
    async timeOut() {
      writes++
      if (actionError) throw actionError
      state = closed
      return { sessionId: 'session' }
    },
    mapAttendanceError(error) { return { code: error.code === 'unavailable' ? 'OFFLINE' : error.code || error.message, message: error.message || 'Unable to confirm attendance.' } },
  }
  const module = new SourceTextModule(await readFile('src/services/studentAttendanceController.js', 'utf8'))
  await module.link(specifier => {
    const exports = specifier.endsWith('attendance.js') ? sdk : presentation
    return new SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value) })
  })
  await module.evaluate()
  const model = module.namespace.attendanceUiState()
  const controller = module.namespace.createStudentAttendanceController(model)
  return { model, controller, writes: () => writes, unsubscribed: () => unsubscribed,
    release: () => release(), emit: value => { state = value; next(value) },
    cache: () => unconfirmed(), fail: error => fail(error),
  }
}

test('confirmed empty attendance displays OUT with zero completed hours, not during loading', async () => {
  const { model, controller } = await setup()
  assert.equal(model.ready, false)
  assert.equal(model.loading, true)
  controller.start(); await settle()
  assert.equal(model.ready, true)
  const display = presentation.presentAttendance(model.state, model.records, profile, now)
  assert.equal(display.status, 'OUT')
  assert.equal(display.totalHours, '0h 00m')
  assert.equal(display.progressPercent, 0)
  assert.equal(display.action, 'Time In')
  controller.stop()
})
test('open and completed-today displays use trusted timestamps and exclude open hours', () => {
  const display = presentation.presentAttendance(opened, recordsFor(opened), profile, now)
  assert.equal(display.status, 'IN')
  assert.equal(display.timeIn, '8:03 AM')
  assert.equal(display.timeOut, '--')
  assert.equal(display.action, 'Time Out')
  assert.equal(display.totalHours, '0h 00m')
  const finished = presentation.presentAttendance(closed, recordsFor(closed), profile, now)
  assert.equal(finished.completedToday, true)
  assert.equal(finished.todayHours, '7h 57m')
  assert.equal(finished.remainingHours, '478h 03m')
})
test('Time In waits for confirmation, prevents duplicate clicks, then shows success', async () => {
  const t = await setup({ delayed: true })
  t.controller.start(); await settle()
  const writing = t.controller.submit()
  await t.controller.submit()
  assert.equal(t.writes(), 1)
  assert.equal(t.model.busy, true)
  assert.equal(t.model.notice, '')
  assert.equal(t.model.ready, false)
  t.release(); await writing; await settle()
  assert.equal(t.model.state.status, 'IN')
  assert.match(t.model.notice, /Time In recorded successfully/)
  t.controller.stop()
})
test('Time Out success displays persisted OUT state', async () => {
  const t = await setup({ initial: opened })
  t.controller.start(); await settle(); await t.controller.submit(); await settle()
  assert.equal(t.model.state.timeOut, now)
  assert.match(t.model.notice, /Time Out recorded successfully/)
  t.controller.stop()
})
for (const initial of [null, opened]) {
  test(`${initial ? 'Time Out' : 'Time In'} failure never reports success and requires reconciliation`, async () => {
    const t = await setup({ initial, actionError: { code: 'OFFLINE' } })
    t.controller.start(); await settle(); await t.controller.submit()
    assert.equal(t.model.ready, false)
    assert.equal(t.model.busy, false)
    assert.equal(t.model.notice, '')
    assert.match(t.model.error, /offline/)
    t.controller.stop()
  })
}
test('remount/session restoration reads existing IN without writing or timing out', async () => {
  const t = await setup({ initial: opened })
  t.controller.start(); await settle(); t.controller.stop()
  assert.equal(t.writes(), 0)
  assert.equal(t.unsubscribed(), 1)
  const restored = await setup({ initial: opened })
  restored.controller.start(); await settle()
  assert.equal(restored.model.state.status, 'IN')
  assert.equal(restored.writes(), 0)
  restored.controller.stop()
})
test('live changes refresh history; cache/offline/error is never confirmed OUT', async () => {
  const t = await setup({ initial: opened })
  t.controller.start(); await settle()
  t.emit(closed); await settle()
  assert.equal(t.model.records[0].status, 'OUT')
  t.cache()
  assert.equal(t.model.ready, false)
  assert.match(t.model.error, /confirmation/)
  t.controller.offline()
  assert.match(t.model.error, /offline/)
  t.controller.stop()
})
test('malformed history blocks actions and totals instead of counting it', async () => {
  const t = await setup({ initial: opened, historyError: true })
  t.controller.start(); await settle()
  assert.equal(t.model.ready, false)
  assert.match(t.model.error, /needs review/)
  await t.controller.submit()
  assert.equal(t.writes(), 0)
  assert.throws(() => presentation.validateAttendanceHistory(null, recordsFor(opened)), /ATTENDANCE_INCONSISTENT/)
  t.controller.stop()
})
test('stopped controllers ignore queued listener callbacks', async () => {
  const t = await setup()
  t.controller.start(); t.controller.stop(); await settle()
  assert.equal(t.model.ready, false)
  assert.equal(t.writes(), 0)
})
test('Manila formatting is explicit across UTC midnight and overnight sessions', () => {
  const previous = Timestamp.fromDate(new Date('2026-09-28T15:59:00Z'))
  assert.equal(presentation.formatManilaDate(previous), 'September 28, 2026')
  assert.equal(presentation.formatManilaTime(previous), '11:59 PM')
  assert.equal(presentation.formatManilaDate(Timestamp.fromDate(new Date('2026-09-28T16:00:00Z'))), 'September 29, 2026')
  const overnight = { ...opened, timeIn: previous, updatedAt: previous }
  const display = presentation.presentAttendance(overnight, recordsFor(overnight), profile, now)
  assert.equal(display.carriedOver, true)
  assert.equal(display.todayHours, '0h 00m')
})
