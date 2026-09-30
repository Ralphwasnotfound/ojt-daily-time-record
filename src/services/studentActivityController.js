import { activityContent, activityError } from './supabaseActivityData.js'
import { checkPhoto } from './activityPhoto.js'

export function activityEditorState() {
  return { busy: false, phase: '', error: '', notice: '', attempt: null, unresolved: false, saved: null, conflict: null }
}
// Each editor owns one attempt. Keep its immutable content/file/request ID through
// every retry; no automatic allocation or mutation retry after a lost response.
export function createActivityController(state, { api, summary, allowed, uuid = () => crypto.randomUUID() }) {
  let stopped = false
  const active = () => !stopped && allowed()
  function finish(row) {
    state.saved = row; state.notice = state.attempt.base ? 'Activity updated.' : 'Activity submitted.'
    state.attempt = null; state.unresolved = false; state.error = ''
  }
  async function reconcile() {
    const attempt = state.attempt
    if (!attempt || !active()) return 'stop'
    const id = attempt.base?.id || attempt.draft?.activity_id
    if (id) {
      const row = await api.details(id)
      if (!active()) return 'stop'
      if (!attempt.base && row) { finish(row); return 'saved' }
      if (attempt.base) {
        if (!row) throw new Error('ACTIVITY_NOT_FOUND')
        const path = attempt.draft?.photo_path || attempt.base.photo_path
        if (row.revision === attempt.base.revision + 1 && row.category === attempt.content.category &&
            row.description === attempt.content.description && row.photo_path === path) { finish(row); return 'saved' }
        if (row.revision !== attempt.base.revision) {
          state.conflict = row; state.error = activityError(new Error('ACTIVITY_CHANGED'))
          state.unresolved = false
          return 'conflict'
        }
      }
    }
    if (attempt.uploadUncertain && attempt.draft) {
      attempt.uploaded = await api.proofMatches(attempt.draft, attempt.file)
      if (!active()) return 'stop'
      attempt.uploadUncertain = false
    }
    state.unresolved = false
    return 'retry'
  }
  return {
    async save(form, base = null) {
      if (state.busy || !active()) return
      state.busy = true; state.error = ''; state.notice = ''; state.saved = null; state.conflict = null
      try {
        if (state.attempt && (state.attempt.mutationSent || state.unresolved || state.attempt.uploadUncertain)) {
          state.phase = 'Checking server result…'
          if (await reconcile() !== 'retry' || !active()) return
        }
        if (!state.attempt) {
          const content = activityContent(form.category, form.description)
          if (!base || form.file) checkPhoto(form.file)
          state.attempt = { requestId: uuid(), content, file: form.file, base: base ? { ...base } : null,
            draft: null, prepareSent: false, uploaded: false, uploadUncertain: false, mutationSent: false }
        }
        const attempt = state.attempt
        if (!attempt.base) {
          state.phase = 'Checking attendance…'
          const attendance = await summary()
          if (!active()) return
          if (!attendance.open_session_id) throw new Error('NO_OPEN_ATTENDANCE')
        }
        if (attempt.file && !attempt.draft) {
          state.phase = 'Preparing photo…'
          attempt.prepareSent = true
          attempt.draft = await api.prepare(attempt.requestId, attempt.base?.id || null)
          if (!active()) return
        }
        if (attempt.file && !attempt.uploaded) {
          state.phase = 'Uploading photo…'; attempt.uploadUncertain = true
          await api.upload(attempt.draft, attempt.file)
          if (!active()) return
          attempt.uploaded = true; attempt.uploadUncertain = false
        }
        state.phase = 'Saving activity…'; attempt.mutationSent = true
        const row = await (attempt.base ? api.edit(attempt.base, attempt.content, attempt.draft) : api.create(attempt.draft, attempt.content))
        if (active()) finish(row)
      } catch (error) {
        if (!active()) return
        state.error = activityError(error)
        if (state.attempt?.mutationSent || state.attempt?.uploadUncertain) {
          state.unresolved = true; state.phase = 'Checking server result…'
          try { await reconcile() } catch { if (active()) state.unresolved = true }
        }
      } finally { if (active()) { state.busy = false; state.phase = '' } }
    },
    async check() {
      if (state.busy || !active()) return
      state.busy = true; state.phase = 'Checking server result…'
      try {
        const result = await reconcile()
        if (active() && result === 'retry') state.notice = 'Checked the server. You may retry this same submission or clear this draft.'
      } catch (error) { if (active()) { state.error = activityError(error); state.unresolved = true } }
      finally { if (active()) { state.busy = false; state.phase = '' } }
    },
    async clear() {
      if (state.busy || !active()) return false
      state.busy = true; state.error = ''; state.phase = 'Checking draft…'
      try {
        if (state.attempt?.mutationSent && await reconcile() === 'saved') return true
        if (!active()) return false
        const attempt = state.attempt
        if (attempt?.prepareSent && !attempt.draft) {
          // A lost prepare response may have allocated a reservation. Recover the
          // same request, never generate a new request merely to clean it up.
          try { attempt.draft = await api.prepare(attempt.requestId, attempt.base?.id || null) }
          catch (error) { if (error?.message !== 'NO_OPEN_ATTENDANCE') throw error }
        }
        if (!active()) return false
        if (attempt?.draft && state.conflict?.photo_path !== attempt.draft.photo_path) await api.discard(attempt.draft)
        if (!active()) return false
        state.attempt = null; state.unresolved = false; state.notice = ''; state.conflict = null
        return true
      } catch (error) { if (active()) state.error = activityError(error); return false }
      finally { if (active()) { state.busy = false; state.phase = '' } }
    },
    stop() { stopped = true; Object.assign(state, activityEditorState()) },
  }
}

export function activityFeedState() { return { records: [], busy: false, error: '', next: false, page: 0 } }
export function createActivityFeed(state, api, size = 25) {
  let generation = 0, stopped = false
  let cursors = [null]
  async function load(page, refresh = false) {
    if (stopped || (state.busy && !refresh)) return
    const version = ++generation
    if (refresh) { cursors = [null]; page = 0; state.page = 0; state.records = []; state.next = false }
    state.busy = true; state.error = ''
    try {
      const rows = await api.history(size, cursors[page])
      if (stopped || version !== generation) return
      state.records = rows; state.page = page; state.next = rows.length === size
      cursors[page + 1] = rows.at(-1) || null
    } catch (error) { if (!stopped && version === generation) state.error = activityError(error) }
    finally { if (!stopped && version === generation) state.busy = false }
  }
  return { refresh: () => load(0, true), next: () => state.next ? load(state.page + 1) : undefined,
    previous: () => state.page > 0 ? load(state.page - 1) : undefined,
    stop() { stopped = true; generation++; Object.assign(state, activityFeedState()) } }
}
