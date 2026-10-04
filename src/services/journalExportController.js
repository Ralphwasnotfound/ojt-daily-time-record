import { canExportJournal } from './journalReportModel.js'
import { prepareJournalExport, exportFilename } from './journalExportModel.js'
export function journalExportState() { return { busy: false, progress: '', error: '', notice: '' } }
export function createJournalExportController(state, { currentReport, identity, readProof, convertImage, validateReport, pdf, docx, print, save }) {
  let generation = 0, pending = null
  function cancel() { generation++; pending?.abort(); pending = null; state.busy = false; state.progress = ''; state.error = ''; state.notice = '' }
  return {
    cancel,
    async run(kind, includePhotos) {
      if (state.busy || !['pdf', 'docx', 'print'].includes(kind)) return
      const original = currentReport(), key = identity()
      if (!original || !key) return
      if (!canExportJournal(original)) { state.error = 'Journal export requires at least one activity in the selected dates.'; state.notice = ''; return }
      const captured = JSON.stringify(original), report = JSON.parse(captured)
      const version = ++generation, abort = new AbortController(); pending = abort
      const check = () => { if (abort.signal.aborted || version !== generation || identity() !== key || currentReport() !== original) throw Error('EXPORT_CANCELLED') }
      state.busy = true; state.error = ''; state.notice = ''; state.progress = 'Preparing journal…'
      try {
        const prepared = await prepareJournalExport(report, { includePhotos, readProof, convertImage, signal: abort.signal, check, progress: (done, total) => { check(); state.progress = `Preparing photos: ${done} / ${total}` } })
        check(); state.progress = 'Checking current records…'
        const latest = await validateReport(report.range, abort.signal); check()
        if (JSON.stringify(latest) !== captured) throw Error('EXPORT_CHANGED')
        if (kind !== 'print') { state.progress = kind === 'pdf' ? 'Generating PDF…' : 'Generating Word document…'; const blob = await (kind === 'pdf' ? pdf : docx)(prepared); check(); await save(blob, exportFilename(report, kind)) }
        else { state.progress = 'Opening print dialog…'; await print(prepared, abort.signal); check() }
        state.notice = `${kind === 'pdf' ? 'PDF generated.' : kind === 'docx' ? 'Word document generated.' : 'Print dialog opened.'}${prepared.unavailablePhotos ? ` ${prepared.unavailablePhotos} activity photo(s) unavailable.` : ''}`
      } catch (error) {
        if (version === generation && !abort.signal.aborted) state.error = error.message === 'JOURNAL_NO_ACTIVITIES' ? 'Journal export requires at least one activity in the selected dates.' : error.message === 'EXPORT_CHANGED' ? 'Records changed during preparation. Refresh the journal and try again.' : error.message === 'EXPORT_TOO_LARGE' ? 'This report is too large. Turn off Activity Photos; if it still exceeds the limits, export a shorter Date Range.' : error.message === 'DOCX_UNSUPPORTED_TEXT' ? 'Some characters cannot be represented in a Word document. The journal entries were not changed.' : error.message === 'PDF_UNSUPPORTED_TEXT' ? 'The PDF font cannot display some characters. Use Print / Save as PDF for this report.' : 'The report could not be prepared. Check your connection and try again.'
      } finally { if (version === generation) { state.busy = false; state.progress = ''; pending = null } }
    },
  }
}
