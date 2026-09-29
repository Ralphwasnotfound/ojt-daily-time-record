import test from 'node:test'
import assert from 'node:assert/strict'
import { Timestamp } from 'firebase/firestore'
import { sameManilaDay, calculateSessionDuration, calculateTotalCompletedDuration } from '../src/services/attendanceTime.js'

const stamp = iso => Timestamp.fromDate(new Date(iso))
test('Manila days cross at 16:00 UTC, including month/year boundaries', () => {
  for (const [before, after] of [
    ['2026-09-29T15:59:59.999Z', '2026-09-29T16:00:00Z'],
    ['2026-09-30T15:59:59.999Z', '2026-09-30T16:00:00Z'],
    ['2026-12-31T15:59:59.999Z', '2026-12-31T16:00:00Z'],
  ]) assert.equal(sameManilaDay(stamp(before), stamp(after)), false)
  assert.equal(sameManilaDay(stamp('2026-09-29T16:00:00Z'), stamp('2026-09-30T15:59:59Z')), true)
})
test('durations retain nanoseconds; totals exclude open sessions and do not round', () => {
  const closed = { status: 'OUT', timeIn: new Timestamp(1, 999999999), timeOut: new Timestamp(2, 1) }
  assert.equal(calculateSessionDuration(closed), 2n)
  assert.equal(calculateTotalCompletedDuration([closed, closed, { status: 'IN', timeIn: new Timestamp(1, 0), timeOut: null }]), 4n)
  assert.equal(calculateTotalCompletedDuration([]), 0n)
  assert.equal(calculateSessionDuration({ ...closed, timeOut: closed.timeIn }), 0n)
})
test('malformed timestamps and reversed/invalid intervals fail explicitly', () => {
  for (const timeIn of [null, {}, '8 AM', { seconds: NaN, nanoseconds: 0 }, { seconds: 1, nanoseconds: 1e9 }]) {
    assert.throws(() => calculateSessionDuration({ status: 'IN', timeIn, timeOut: null }), /ATTENDANCE_INCONSISTENT/)
  }
  assert.throws(() => calculateTotalCompletedDuration([{ status: 'OUT', timeIn: new Timestamp(2, 0), timeOut: new Timestamp(1, 0) }]), /ATTENDANCE_INCONSISTENT/)
  assert.throws(() => calculateSessionDuration({ status: 'OUT', timeIn: new Timestamp(1, 0), timeOut: null }), /ATTENDANCE_INCONSISTENT/)
})
