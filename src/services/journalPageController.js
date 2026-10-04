import { journalDay, journalRange } from './journalReportModel.js'
export function journalPageState(now = new Date().toISOString()) {
  const today = journalDay(now)
  return { mode: 'daily', from: today, to: today, report: null, loading: false, error: '' }
}
export function journalSelectionError(state) {
  if (state.mode === 'complete') return ''
  if (!['daily','range'].includes(state.mode)) return 'Choose a valid journal scope.'
  if (!state.from || (state.mode === 'range' && !state.to)) return 'Choose the journal date or both range dates.'
  if (state.mode === 'range' && state.to < state.from) return 'The end date must be on or after the start date.'
  try { journalRange(state.from, state.mode === 'daily' ? state.from : state.to) }
  catch { return 'Choose valid dates between 2000 and 2100, covering no more than 31 calendar days.' }
  return ''
}
export function createJournalPageController(state, reader, allowed) {
  let version = 0
  function clear() {
    version++; reader.cancel(); state.report = null; state.loading = false; state.error = ''
  }
  return {
    clear,
    async load() {
      clear()
      const current = version
      state.error = journalSelectionError(state)
      if (state.error) return
      if (!allowed()) { state.error = 'Please sign in with an approved Student account.'; return }
      state.loading = true
      try {
        const report = state.mode === 'complete' ? await reader.prepareComplete() : await reader.prepare(state.from, state.mode === 'daily' ? state.from : state.to)
        if (current === version && allowed()) state.report = report
      } catch (error) {
        if (current === version && allowed()) state.error = error.message === 'JOURNAL_COMPLETE_TOO_LARGE' ? 'The complete journal exceeds the supported read limits. Use Date Range to view a shorter period.' : error.message === 'JOURNAL_COMPLETE_CHANGED' ? 'Records changed while loading. Refresh the complete journal and try again.' : 'The journal could not be loaded. Check your connection, then try again.'
      } finally { if (current === version) state.loading = false }
    },
  }
}
