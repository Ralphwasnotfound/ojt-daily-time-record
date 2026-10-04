import { readJournalActivityProof, journalProofIdentity } from './journalActivityProof.js'
import { createStudentJournalReader } from './supabaseJournal.js'
import { convertJournalImage } from './journalExportImages.js'
import { generateJournalDocx } from './journalDocx.js'
import { generateJournalPdf } from './journalPdf.js'
import { printJournalReport } from './journalPrint.js'
import { createJournalExportController } from './journalExportController.js'
export function createStudentJournalExporter(state, currentReport) {
  const reader = createStudentJournalReader(), urls = new Map()
  const controller = createJournalExportController(state, {
    currentReport, identity: journalProofIdentity, readProof: readJournalActivityProof, convertImage: convertJournalImage,
    validateReport: range => range.scope === 'complete' ? reader.prepareComplete() : reader.prepare(range.from, range.to), pdf: generateJournalPdf, docx: generateJournalDocx, print: printJournalReport,
    async save(blob, filename) {
      const url = URL.createObjectURL(blob), link = document.createElement('a')
      urls.set(url, setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url) }, 30000))
      link.href = url; link.download = filename; document.body.appendChild(link)
      try { link.click() } finally { link.remove() }
    },
  })
  return { run: controller.run, cancel() { controller.cancel(); reader.cancel(); for (const [url, timer] of urls) { clearTimeout(timer); URL.revokeObjectURL(url) }; urls.clear() } }
}
