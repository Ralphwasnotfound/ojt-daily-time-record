import { supabase } from '../supabase/supabase.js'
import { authState } from './auth'
import { activityContent } from './supabaseActivityData.js'
import { checkPhoto } from './activityPhoto.js'

export function activityAccountKey() {
  return `${authState.user?.id}:${authState.profile?.uid}:${authState.profile?.role}:${authState.profile?.status}`
}
export function approvedActivityStudent() {
  return authState.provider === 'supabase' && !!authState.user?.id && authState.profile?.uid === authState.user.id &&
    authState.profile?.role === 'student' && authState.profile?.status === 'approved'
}
export function createActivityApi(client, account) {
  function identity() {
    const user = account()
    if (!user?.id) throw new Error('AUTHENTICATION_REQUIRED')
    if (!user.approved) throw new Error('APPROVED_STUDENT_REQUIRED')
    return user.id
  }
  async function request(make) {
    const id = identity(), controller = new AbortController()
    let timeout
    const deadline = new Promise((_, reject) => { timeout = setTimeout(() => {
      controller.abort(); reject(new Error('RESULT_UNKNOWN'))
    }, 20000) })
    try {
      const { data, error } = await Promise.race([make(controller.signal), deadline])
      if (identity() !== id) throw new Error('AUTHENTICATION_REQUIRED')
      if (error) throw error
      return data
    } finally { clearTimeout(timeout) }
  }
  function rpc(name, args) { return request(signal => client.rpc(name, args).retry(false).abortSignal(signal)) }
  return {
    async prepare(requestId, existingId = null) {
      const rows = await rpc('activity_prepare', { request_id: requestId, existing_activity_id: existingId })
      if (rows?.length !== 1 || !rows[0].upload_id || !rows[0].photo_path?.startsWith(identity() + '/')) throw new Error('INVALID_UPLOAD')
      return rows[0]
    },
    async upload(draft, file) {
      checkPhoto(file)
      // This SDK's upload has no AbortSignal option. A deadline is an unknown
      // outcome, not cancellation; reconciliation retains this exact path/file.
      return request(() => client.storage.from('activity-proofs').upload(draft.photo_path, file,
        { contentType: file.type, upsert: false }))
    },
    create(draft, content) { return rpc('activity_create', { upload_id: draft.upload_id, ...activityContent(content.category, content.description) }) },
    edit(record, content, draft = null) {
      return rpc('activity_edit', { activity_id: record.id, expected_revision: record.revision,
        ...activityContent(content.category, content.description), replacement_upload_id: draft?.upload_id || null })
    },
    async details(id) {
      const uid = identity()
      return request(signal => client.from('activities').select('*').eq('student_uid', uid).eq('id', id).maybeSingle().retry(false).abortSignal(signal))
    },
    history(size = 25, cursor = null) {
      return rpc('activity_history', { page_size: size, before_created_at: cursor?.created_at || null, before_id: cursor?.id || null })
    },
    download(path) { return request(signal => client.storage.from('activity-proofs').download(path, {}, { signal, cache: 'no-store' })) },
    async proofMatches(draft, file) {
      let stored
      try { stored = await this.download(draft.photo_path) }
      catch (error) {
        if (String(error.statusCode || error.status) === '404' || /object not found/i.test(error.message)) return false
        throw error
      }
      if (stored.size !== file.size) throw new Error('INVALID_PROOF')
      const [a,b] = await Promise.all([stored.arrayBuffer(), file.arrayBuffer()])
      if (!new Uint8Array(a).every((value,index) => value === new Uint8Array(b)[index])) throw new Error('INVALID_PROOF')
      return true
    },
    async discard(draft) {
      const path = await rpc('activity_discard_proof', { upload_id: draft.upload_id })
      if (path !== draft.photo_path) throw new Error('INVALID_UPLOAD')
      // The RPC tombstone authorizes deletion, never a timeout alone. Storage's
      // remove endpoint does not accept AbortSignal; failure can be retried safely
      // because this path is tombstoned and can no longer become attached.
      return request(() => client.storage.from('activity-proofs').remove([path]))
    },
  }
}
export const activityApi = createActivityApi(supabase, () => ({ id: authState.user?.id, approved: approvedActivityStudent() }))
