import { requireJournalActivities, JOURNAL_EMPTY_ACTIVITY_MESSAGE } from './journalReportModel.js'

// Prepared presentation facts only; the library is loaded on the Word action.
export async function generateJournalDocx(report) {
  requireJournalActivities(report)
  const { Document, Paragraph, TextRun, Tab, ImageRun, Table, TableRow, TableCell, WidthType, Packer } = await import('docx')
  function runs(text, bold = false) {
    // XML cannot represent these characters. Refuse rather than silently change entries.
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u.test(text) || /[\uD800-\uDFFF]/u.test(text)) throw Error('DOCX_UNSUPPORTED_TEXT')
    return String(text).split(/(\r\n|\r|\n|\t)/).map(part => part === '\t' ? new TextRun({ children: [new Tab()] }) : /^(?:\r\n|\r|\n)$/.test(part) ? new TextRun({ break: 1 }) : new TextRun({ text: part, bold }))
  }
  const paragraph = (text, options = {}) => new Paragraph({ children: runs(text, options.bold), spacing: { after: 120 }, ...options })
  const children = [paragraph('BSIT / TCC', { bold: true }), paragraph('OJT Journal', { heading: 'Title' }),
    paragraph(report.student.fullName, { heading: 'Heading1' }),
    paragraph(`Student ID: ${report.student.studentId}\nProgram: ${report.student.program}\nRequired OJT Hours: ${report.student.requiredHours}\nSelected dates: ${report.selectedDates}\nTimezone: Asia/Manila`),
    paragraph(`Selected Journal Completed Hours: ${report.selectedHours}\nTotal Completed OJT Hours (all dates): ${report.totalHours}`),
    paragraph(`Generated: ${report.generatedAt}`)]
  for (const day of report.days) {
    children.push(paragraph(`${day.date} · Completed: ${day.completed}`, { heading: 'Heading1', keepNext: true }))
    if (!day.activities.length) children.push(paragraph(JOURNAL_EMPTY_ACTIVITY_MESSAGE))
    for (const activity of day.activities) {
      children.push(paragraph(`${activity.time} · ${activity.category}${activity.edited ? ' · Edited' : ''}`, { bold: true, keepNext: true }), paragraph(activity.description))
      if (activity.photo) {
        const photo = activity.photo, match = photo.data.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/)
        if (!match || !(photo.width > 0 && photo.height > 0)) throw Error('INVALID_EXPORT_IMAGE')
        const data = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0))
        const scale = Math.min(1, 540 / photo.width, 280 / photo.height)
        children.push(new Paragraph({ children: [new ImageRun({ type: match[1] === 'jpeg' ? 'jpg' : 'png', data, transformation: { width: Math.max(1, Math.round(photo.width * scale)), height: Math.max(1, Math.round(photo.height * scale)) }, altText: { title: 'Activity proof', description: `Recorded activity proof · ${activity.time} · ${activity.category}`, name: 'Activity proof' } })], keepNext: true, spacing: { after: 60 } }), paragraph(`Activity proof · ${activity.time} · ${activity.category}`))
      }
      if (activity.photoNote) children.push(paragraph(activity.photoNote))
    }
    if (day.sessions.length) {
      children.push(paragraph(`Attendance summary · ${day.date}`, { bold: true, keepNext: true }))
      const row = (values, header = false) => new TableRow({ tableHeader: header, cantSplit: true, children: values.map(value => new TableCell({ children: [paragraph(String(value), { bold: header, keepNext: true })] })) })
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [row(['Session', 'Time In', 'Time Out'], true), ...day.sessions.map(session => row([session.ordinal, session.timeIn, session.timeOut]))] }))
    }
    children.push(paragraph(`Daily completed time: ${day.completed}. Completed sessions only; breaks and ongoing sessions excluded.`))
  }
  const doc = new Document({ title: 'OJT Journal', creator: 'BSIT / TCC', description: 'OJT Journal',
    styles: { default: { document: { run: { font: { ascii: 'Arial', hAnsi: 'Arial', cs: 'Arial' }, size: 22 }, paragraph: { spacing: { after: 120, line: 276 } } } }, paragraphStyles: [
      { id: 'Title', name: 'Title', basedOn: 'Normal', run: { font: { ascii: 'Arial', hAnsi: 'Arial', cs: 'Arial' }, size: 44, bold: true }, paragraph: { spacing: { before: 120, after: 240 }, keepNext: true } },
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', run: { font: { ascii: 'Arial', hAnsi: 'Arial', cs: 'Arial' }, size: 28, bold: true }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true } },
    ] }, sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 850, bottom: 850, left: 850, right: 850 } } }, children }] })
  return Packer.toBlob(doc)
}
