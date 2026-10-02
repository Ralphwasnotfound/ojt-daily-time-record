import { supabase } from '../supabase/supabase.js'
import { authState } from './auth'
import { trackAttendanceWrite } from './supabaseAttendance.js'
import { checkSelfie } from './attendanceCapture.js'
import { validAttendanceLocation } from './attendanceLocation.js'

export function attendanceProofAccount() {
  return { id: authState.user?.id, approved: authState.provider === 'supabase' &&
    authState.profile?.uid === authState.user?.id && authState.profile?.role === 'student' && authState.profile?.status === 'approved' }
}
export function createAttendanceProofApi(client, account, timeoutMs = 20000) {
  // One API instance is bound to the identity opening this verification flow.
  const owner = account()?.id
  function identity() {
    const current = account()
    if (!owner || current?.id !== owner) throw new Error('AUTHENTICATION_REQUIRED')
    if (!current.approved) throw new Error('APPROVED_STUDENT_REQUIRED')
    return owner
  }
  async function request(make) {
    identity(); const controller = new AbortController(); let timer
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('RESULT_UNKNOWN')) }, timeoutMs) })
    try {
      const { data, error } = await Promise.race([Promise.resolve().then(() => { identity(); return make(controller.signal) }), deadline])
      identity(); if (error) throw error; return data
    } finally { clearTimeout(timer) }
  }
  const rpc = (name, args) => request(signal => client.rpc(name, args).retry(false).abortSignal(signal))
  function ticket(draft) {
    const uid = identity()
    if (!draft?.upload_id || !draft.attendance_session_id || draft.photo_path !== `${uid}/${draft.attendance_session_id}/${draft.upload_id}/proof`) throw new Error('INVALID_UPLOAD')
  }
  const api = {
    async prepare(requestId, action) {
      if (!['time_in', 'time_out'].includes(action)) throw new Error('INVALID_ACTION')
      const rows = await rpc('attendance_proof_prepare', { request_id: requestId, action_type: action })
      if (rows?.length !== 1) throw new Error('INVALID_UPLOAD')
      ticket(rows[0]); return rows[0]
    },
    upload(draft, blob) {
      ticket(draft); checkSelfie(blob)
      // No upload AbortSignal in this SDK. Timeout means unknown, never overwrite.
      return request(() => client.storage.from('attendance-proofs').upload(draft.photo_path, blob, { contentType: 'image/jpeg', upsert: false }))
    },
    async uploaded(draft, blob) {
      ticket(draft)
      let stored
      try { stored = await request(signal => client.storage.from('attendance-proofs').download(draft.photo_path, {}, { signal, cache: 'no-store' })) }
      catch (error) { if (String(error.statusCode || error.status) === '404' || /object not found/i.test(error.message)) return false; throw error }
      if (stored.size !== blob.size) throw new Error('PROOF_CONFLICT')
      const [a, b] = await Promise.all([stored.arrayBuffer(), blob.arrayBuffer()])
      identity()
      if (!new Uint8Array(a).every((value, index) => value === new Uint8Array(b)[index])) throw new Error('PROOF_CONFLICT')
      return true
    },
    finalize(draft, location) {
      ticket(draft)
      if (!validAttendanceLocation(location)) throw new Error('INVALID_LOCATION')
      return trackAttendanceWrite(() => rpc('attendance_proof_finalize', { upload_id: draft.upload_id,
        latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracy }))
    },
    result(draft) {
      ticket(draft)
      return request(signal => client.from('attendance_proofs').select('*').eq('upload_id', draft.upload_id).maybeSingle().retry(false).abortSignal(signal))
    },
    async discard(draft) {
      ticket(draft)
      const path = await rpc('attendance_proof_discard', { upload_id: draft.upload_id })
      if (path !== draft.photo_path) throw new Error('INVALID_UPLOAD')
      // Only successful server tombstoning permits removing bytes.
      await request(() => client.storage.from('attendance-proofs').remove([path]))
    },
  }
  return api
}
export function attendanceProofApi() { return createAttendanceProofApi(supabase, attendanceProofAccount) }
