import { requireJournalActivities } from './journalReportModel.js'
import { buildJournalPdf } from './journalExportModel.js'
import { pdfFontSupportsText } from './journalPdfFont.js'
// Both the PDF runtime and bundled fonts stay out of Journal startup.
export async function generateJournalPdf(report, logo = null) {
  requireJournalActivities(report)
  const [{ default: pdfMake }, { default: fonts }] = await Promise.all([
    import('pdfmake/build/pdfmake.js'), import('pdfmake/build/vfs_fonts.js'),
  ])
  if (!pdfFontSupportsText(fonts['Roboto-Regular.ttf'], JSON.stringify(report, (key, value) => key === 'data' ? undefined : value))) throw Error('PDF_UNSUPPORTED_TEXT')
  pdfMake.addVirtualFileSystem(fonts)
  return pdfMake.createPdf(buildJournalPdf(report, logo)).getBlob()
}
