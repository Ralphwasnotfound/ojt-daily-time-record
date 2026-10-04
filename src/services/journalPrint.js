import { requireJournalActivities, JOURNAL_EMPTY_ACTIVITY_MESSAGE } from './journalReportModel.js'
export const JOURNAL_PRINT_CSS = `@page{size:A4 portrait;margin:15mm}body{font:11pt/1.45 Arial,sans-serif;color:#111;margin:0}h1{font-size:24pt;margin:6mm 0}h2{font-size:14pt;margin:8mm 0 3mm;break-after:avoid}h3{font-size:11pt;margin:4mm 0 2mm;break-after:avoid}p{margin:2mm 0;overflow-wrap:anywhere}.description{white-space:pre-wrap}img{max-width:100%;max-height:80mm;object-fit:contain}.photo{break-inside:avoid}.attendance{break-inside:avoid}table{border-collapse:collapse;width:100%;font-size:10pt}th,td{text-align:left;padding:2mm;border-bottom:1px solid #ddd}thead{display:table-header-group}.note{font-size:9pt;color:#444}`
// Isolated same-origin iframe: only report nodes, never the application shell.
export async function printJournalReport(report, signal, parent = document) {
  requireJournalActivities(report)
  if (signal?.aborted) throw Error('EXPORT_CANCELLED')
  const frame = parent.createElement('iframe')
  frame.title = 'OJT Journal print report'; frame.setAttribute('aria-hidden', 'true')
  Object.assign(frame.style, { position: 'fixed', width: '210mm', height: '297mm', left: '-10000px', top: '0', border: '0' })
  parent.body.appendChild(frame)
  const doc = frame.contentDocument, win = frame.contentWindow
  let timer, afterPrint
  let cancelReject
  const cancelled = new Promise((_, reject) => { cancelReject = reject })
  const abort = () => cancelReject(Error('EXPORT_CANCELLED'))
  signal?.addEventListener('abort', abort, { once: true })
  const cleanup = () => { clearTimeout(timer); win?.removeEventListener('afterprint', afterPrint); signal?.removeEventListener('abort', abort); frame.remove() }
  try {
    if (!doc || !win) throw Error('PRINT_UNAVAILABLE')
    doc.title = 'OJT Journal'
    const style = doc.createElement('style'); style.textContent = JOURNAL_PRINT_CSS; doc.head.appendChild(style)
    function node(tag, text, cls, target = doc.body) { const el = doc.createElement(tag); if (text != null) el.textContent = text; if (cls) el.className = cls; target.appendChild(el); return el }
    node('p', 'BSIT / TCC'); node('h1', 'OJT Journal'); node('h2', report.student.fullName)
    node('p', `Student ID: ${report.student.studentId}`); node('p', `Program: ${report.student.program}`)
    node('p', `Required OJT Hours: ${report.student.requiredHours}`); node('p', `Selected dates: ${report.selectedDates} · Asia/Manila`)
    node('p', `Selected Journal Completed Hours: ${report.selectedHours}`); node('p', `Total Completed OJT Hours (all dates): ${report.totalHours}`)
    node('p', `Generated: ${report.generatedAt}`, 'note')
    const images = []
    for (const day of report.days) {
      node('h2', `${day.date} · Completed: ${day.completed}`)
      if (!day.activities.length) node('p', JOURNAL_EMPTY_ACTIVITY_MESSAGE, 'note')
      for (const a of day.activities) {
        node('h3', `${a.time} · ${a.category}${a.edited ? ' · Edited' : ''}`)
        node('p', a.description, 'description')
        if (a.photo) {
          const figure = node('figure', null, 'photo'), img = node('img', null, null, figure)
          img.alt = 'Recorded activity proof photo'
          images.push(new Promise(resolve => { img.onload = resolve; img.onerror = () => { figure.textContent = 'Activity proof photo unavailable'; resolve() }; img.src = a.photo.data }))
        }
        if (a.photoNote) node('p', a.photoNote, 'note')
      }
      if (day.sessions.length) {
        const section = node('section', null, 'attendance'); node('h3', `Attendance summary · ${day.date}`, null, section)
        const table = node('table', null, null, section), head = node('thead', null, null, table), header = node('tr', null, null, head)
        for (const text of ['Session', 'Time In', 'Time Out']) node('th', text, null, header)
        const body = node('tbody', null, null, table)
        for (const s of day.sessions) { const row = node('tr', null, null, body); for (const text of [String(s.ordinal), s.timeIn, s.timeOut]) node('td', text, null, row) }
      }
      node('p', `Daily completed time: ${day.completed}. Completed sessions only; breaks and ongoing sessions excluded.`, 'note')
    }
    await Promise.race([cancelled, Promise.all([...images, doc.fonts?.ready]), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('PRINT_UNAVAILABLE')), 15000) })])
    clearTimeout(timer)
    if (signal?.aborted) throw Error('EXPORT_CANCELLED')
    await Promise.race([cancelled, new Promise((resolve) => {
      afterPrint = resolve
      win.addEventListener('afterprint', afterPrint, { once: true })
      // Some mobile browsers omit afterprint; bound the private frame lifetime.
      timer = setTimeout(resolve, 300000)
      win.focus(); win.print()
    })])
  } finally { cleanup() }
}
