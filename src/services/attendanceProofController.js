import { checkSelfie } from './attendanceCapture.js'
import { getAttendanceLocation, validAttendanceLocation } from './attendanceLocation.js'

const messages = {
  LOCATION_DENIED: 'Location permission was denied by the browser or device. Check Location permission for this exact site and your device location settings, then retry. Attendance has not been submitted.',
  LOCATION_UNAVAILABLE: 'Your location is unavailable. Check location services and retry.',
  LOCATION_TIMEOUT: 'Getting your location timed out. Move to a place with a better signal and retry.',
  LOCATION_UNSUPPORTED: 'This browser cannot provide location. Use a supported browser with location enabled.',
  INVALID_LOCATION: 'A current valid location could not be obtained. Please retry.',
  INVALID_SELFIE: 'The selfie could not be processed. Retake it before continuing.',
  ATTENDANCE_STATE_CHANGED: 'Attendance changed while you were verifying. Cancel this attempt and refresh attendance.',
  ALREADY_TIMED_IN: 'You are already timed in. Cancel this attempt and refresh attendance.',
  NO_OPEN_ATTENDANCE: 'There is no open session to close. Cancel and refresh attendance.',
  DAILY_ATTENDANCE_LIMIT_REACHED: 'Both attendance sessions for this Manila day are complete.',
  UPLOAD_EXPIRED_OR_DISCARDED: 'This verification expired or was cancelled. Cancel it and start again.',
  REQUEST_CONFLICT: 'This attempt conflicts with the recorded result. Cancel and refresh; do not submit a new punch to resolve it.',
  PROOF_CONFLICT: 'The reserved photo does not match this selfie. Cancel this attempt; it will not be overwritten.',
  AUTHENTICATION_REQUIRED: 'Your sign-in changed. Sign in again and refresh attendance.',
  APPROVED_STUDENT_REQUIRED: 'An approved student account is required. Refresh your account status.',
}
export function attendanceProofError(error) {
  if (error?.message === 'LOCATION_DENIED' && error.permissionState === 'granted') return 'Your browser reports Location is allowed, but the location request was still denied. Check your device location services and browser access, then retry. Attendance has not been submitted.'
  if (error?.message === 'LOCATION_DENIED' && error.permissionState === 'denied') return 'This page\'s Location permission is still reported as blocked. Enable Location for this exact site and check device location settings, then retry. Attendance has not been submitted.'
  return messages[error?.message] || 'The result could not be confirmed. Retry this same verification to check the server. Do not start another attempt.'
}
const terminal = new Set(['ATTENDANCE_STATE_CHANGED', 'ALREADY_TIMED_IN', 'NO_OPEN_ATTENDANCE', 'DAILY_ATTENDANCE_LIMIT_REACHED',
  'UPLOAD_EXPIRED_OR_DISCARDED', 'REQUEST_CONFLICT', 'PROOF_CONFLICT', 'AUTHENTICATION_REQUIRED', 'APPROVED_STUDENT_REQUIRED'])
// Recovery-only checkpoints survive route changes in this app session. Never
// retain selfies/coordinates here, and never use a checkpoint to finalize.
const deferredProofs = new Map()
export function getDeferredAttendanceProof(owner) { return deferredProofs.get(owner) || null }
export function attendanceProofState() { return { busy: false, cancelling: false, phase: '', error: '', attempt: null, saved: null, blocked: false, unresolved: false, locationRequests: 0, cancelFailed: false, recoveryOnly: false } }

export function createAttendanceProofController(state, { api, owner, action, allowed, refresh = async () => {}, locate = getAttendanceLocation, uuid = () => crypto.randomUUID() }) {
  let stopped = false, cancelling = false, running = null
  const locationAbort = new AbortController()
  const active = () => !stopped && !cancelling && allowed()
  function clearDeferred(attempt) {
    if (deferredProofs.get(owner)?.attempt.requestId === attempt?.requestId) deferredProofs.delete(owner)
  }
  function validateReceipt(row, attempt, compareLocation = true) {
    if (!row?.id || row.student_uid !== owner || row.upload_id !== attempt.draft?.upload_id ||
      row.attendance_session_id !== attempt.draft.attendance_session_id || row.photo_path !== attempt.draft.photo_path ||
      row.action_type !== action || !Number.isFinite(Date.parse(row.official_punch_at))) throw new Error('INVALID_RECEIPT')
    if (compareLocation && ['latitude', 'longitude', 'accuracy'].some(key => Number(row[key]) !== attempt.location[key])) throw new Error('REQUEST_CONFLICT')
    return row
  }
  function finish(row, attempt, compareLocation = true) {
    validateReceipt(row, attempt, compareLocation)
    clearDeferred(attempt)
    state.saved = row; state.attempt = null; state.error = ''; state.unresolved = false; state.blocked = false
  }
  async function result(attempt, compareLocation = true) {
    const row = await api.result(attempt.draft)
    return row ? validateReceipt(row, attempt, compareLocation) : null
  }
  async function submit(blob) {
    if (!active() || state.busy || state.saved || state.blocked || state.recoveryOnly) return
    state.busy = true; state.error = ''
    try {
      if (!state.attempt) {
        checkSelfie(blob)
        state.attempt = { requestId: uuid(), blob, location: null, draft: null, prepareSent: false, uploaded: false, uploadUncertain: false, finalizeSent: false }
      }
      const attempt = state.attempt
      if (attempt.finalizeSent) {
        state.phase = 'Checking the recorded result…'
        const row = await result(attempt)
        if (!active()) return
        if (row) { finish(row, attempt); return }
        // No row is not proof of failure: retry only this same idempotent request.
      }
      if (!attempt.location) {
        state.locationRequests++
        state.phase = `Getting your location… (attempt ${state.locationRequests})`
        const location = await locate({ signal: locationAbort.signal })
        if (!active()) return
        if (!validAttendanceLocation(location)) throw new Error('INVALID_LOCATION')
        attempt.location = Object.freeze({ latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracy })
      }
      if (!attempt.draft) {
        state.phase = 'Preparing your attendance proof…'; attempt.prepareSent = true
        attempt.draft = await api.prepare(attempt.requestId, action)
        if (!active()) return
      }
      if (attempt.uploadUncertain) {
        state.phase = 'Checking the uploaded selfie…'
        attempt.uploaded = await api.uploaded(attempt.draft, attempt.blob)
        if (!active()) return
        attempt.uploadUncertain = false
      }
      if (!attempt.uploaded) {
        state.phase = 'Uploading your selfie…'; attempt.uploadUncertain = true
        await api.upload(attempt.draft, attempt.blob)
        if (!active()) return
        attempt.uploaded = true; attempt.uploadUncertain = false
      }
      state.phase = 'Recording attendance…'; attempt.finalizeSent = true
      const row = await api.finalize(attempt.draft, attempt.location)
      if (active()) finish(row, attempt)
    } catch (error) {
      if (!active()) return
      state.error = attendanceProofError(error); state.blocked = terminal.has(error?.message)
      if (!state.attempt?.location && state.locationRequests) {
        state.error = `Location attempt ${state.locationRequests}: ${state.error}`
        if (error?.message === 'LOCATION_DENIED' && state.locationRequests > 1) state.error += ' If permissions were changed and denial continues, try cancelling this verification and reloading the page, then capture a new selfie.'
      }
      const attempt = state.attempt
      state.unresolved = !!(attempt?.finalizeSent || attempt?.uploadUncertain)
      if (attempt?.finalizeSent) {
        state.phase = 'Checking the recorded result…'
        try { const row = await result(attempt); if (active() && row) finish(row, attempt) }
        catch { /* Keep the same attempt until an explicit retry or safe discard. */ }
        // A read-only summary refresh must not hold the modal's operation lock.
        // Receipt reconciliation above still completes before Retry/Cancel unlock.
        if (active()) void Promise.resolve().then(() => { if (active()) return refresh() }).catch(() => {})
      }
    } finally { if (!stopped) { state.busy = false; state.phase = '' } }
  }
  async function cleanup(attempt) {
    if (!attempt || !allowed()) return null
    // Cancellation accepts an existing server receipt without rewriting its
    // coordinates. A conflicting local attempt must never delete attached proof.
    if (attempt.finalizeSent) { const row = await result(attempt, false); if (row) return row }
    if (attempt.prepareSent && !attempt.draft) {
      try { attempt.draft = await api.prepare(attempt.requestId, action) }
      catch (error) {
        // No finalize could have been sent without a recovered upload ID. Unknown
        // expired/stale reservations remain future orphan-cleanup work, not punches.
        if (['UPLOAD_EXPIRED_OR_DISCARDED', 'ATTENDANCE_STATE_CHANGED', 'ALREADY_TIMED_IN', 'NO_OPEN_ATTENDANCE', 'DAILY_ATTENDANCE_LIMIT_REACHED'].includes(error?.message)) return null
        throw error
      }
    }
    if (!allowed()) return null
    if (attempt.draft) {
      try { await api.discard(attempt.draft) }
      catch (error) {
        if (error?.message !== 'PROOF_IN_USE') throw error
        const row = await result(attempt, false)
        if (!row) throw new Error('RESULT_UNKNOWN')
        return row
      }
    }
    return null
  }
  return {
    submit(blob) {
      if (running || cancelling || stopped) return running
      running = submit(blob).finally(() => { running = null })
      return running
    },
    async cancel() {
      if (cancelling || stopped) return false
      cancelling = true; state.cancelling = true; state.cancelFailed = false; state.recoveryOnly = true; locationAbort.abort()
      try {
        await running
        if (state.saved) return true
        const attempt = state.attempt, row = await cleanup(attempt)
        if (stopped || !allowed()) return false
        if (row) finish(row, attempt, false)
        else { clearDeferred(attempt); state.attempt = null; state.error = ''; state.unresolved = false }
        return true
      } catch {
        if (!stopped) {
          state.cancelFailed = true
          state.error = 'Cancellation could not be confirmed. Check again when connected, or close for now. Another attendance attempt stays blocked until this verification is resolved.'
        }
        return false
      } finally { cancelling = false; if (!stopped) state.cancelling = false }
    },
    defer() {
      // Offer escape only after reconciliation failed and bounded I/O settled.
      if (stopped || running || cancelling || state.busy || !state.cancelFailed || !state.attempt) return false
      const attempt = state.attempt
      deferredProofs.set(owner, { action, attempt: {
        requestId: attempt.requestId, draft: attempt.draft ? { ...attempt.draft } : null,
        prepareSent: attempt.prepareSent, finalizeSent: attempt.finalizeSent,
      } })
      stopped = true; locationAbort.abort()
      Object.assign(state, attendanceProofState())
      return true
    },
    stop() {
      if (stopped) return
      stopped = true; cancelling = true; locationAbort.abort()
      const attempt = state.attempt, work = running
      Object.assign(state, attendanceProofState())
      // Route/background teardown never finalizes. A late prepare/upload settles
      // before best-effort tombstoning. Failed cleanup is an orphan, not a retry.
      void Promise.resolve(work).then(() => cleanup(attempt)).catch(() => {})
    },
  }
}
