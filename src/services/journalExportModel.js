import { journalRange, journalCompletePeriod, journalDay, requireJournalActivities, JOURNAL_EMPTY_ACTIVITY_MESSAGE } from './journalReportModel.js'
import { activityDate, activityTime } from './supabaseActivityData.js'
import { duration } from './supabaseAttendancePresentation.js'
export const EXPORT_LIMITS = Object.freeze({ activities: 500, photos: 100, imageBytes: 20 * 1024 * 1024, imageEdge: 1600, imagePixels: 24000000 })
export function exportFilename(report, format = 'pdf') {
  if (!['pdf', 'docx'].includes(format)) throw Error('INVALID_EXPORT_FORMAT')
  const id = String(report.student.studentId).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40) || 'Student'
  return `OJT-Journal_${id}_${report.range.scope === 'complete' ? 'Complete-OJT_' : ''}${report.range.from}${report.range.to === report.range.from ? '' : '_to_' + report.range.to}.${format}`
}
export function exportDate(day) { return activityDate(day + 'T00:00:00+08:00') }
export function exportTimeOut(session, day) {
  return !session.timeOut ? 'Ongoing' : journalDay(session.timeOut) === day ? activityTime(session.timeOut) : `${activityDate(session.timeOut)} · ${activityTime(session.timeOut)}`
}
export async function prepareJournalExport(report, { includePhotos = true, readProof, convertImage, signal, check = () => {}, progress = () => {}, now = new Date().toISOString() }) {
  requireJournalActivities(report)
  if(report.range.scope==='complete')journalCompletePeriod(report.range.from,report.range.to)
  else journalRange(report.range.from, report.range.to)
  const count = report.days.reduce((n, d) => n + d.activities.length, 0)
  const photoCount = report.days.reduce((n, d) => n + d.activities.filter(a => report.internal.sources[a.sourceIndex]?.proofPath).length, 0)
  if (count > EXPORT_LIMITS.activities || (includePhotos && photoCount > EXPORT_LIMITS.photos)) throw Error('EXPORT_TOO_LARGE')
  const valid = () => { if (signal?.aborted) throw Error('EXPORT_CANCELLED'); check() }
  valid()
  let bytes = 0, completed = 0, unavailablePhotos = 0
  const days = []
  for (const day of report.days) {
    const activities = []
    for (const activity of day.activities) {
      valid()
      const entry = { time: activityTime(activity.createdAt), category: activity.category, description: activity.description, edited: activity.edited, photo: null, photoNote: '' }
      const path = report.internal.sources[activity.sourceIndex]?.proofPath
      if (includePhotos && path) {
        try {
          const blob = await readProof(path, signal); valid()
          entry.photo = await convertImage(blob, signal); valid()
          if (!/^data:image\/(?:png|jpeg);base64,/.test(entry.photo.data) || !(entry.photo.width > 0 && entry.photo.height > 0)) throw Error('INVALID_EXPORT_IMAGE')
          bytes += entry.photo.bytes
          if (!Number.isFinite(bytes) || bytes > EXPORT_LIMITS.imageBytes) throw Error('EXPORT_TOO_LARGE')
        } catch (error) {
          valid()
          if (error.message === 'EXPORT_TOO_LARGE') throw error
          entry.photo = null; entry.photoNote = 'Activity proof photo unavailable'; unavailablePhotos++
        }
        progress(++completed, photoCount)
      } else if (includePhotos && !path) entry.photoNote = 'No proof photo available'
      activities.push(entry)
    }
    days.push({ date: exportDate(day.date), completed: duration(day.completedSeconds), activities,
      sessions: day.sessions.map(s => ({ ordinal: s.ordinal, timeIn: activityTime(s.timeIn), timeOut: exportTimeOut(s, day.date) })) })
  }
  valid()
  return { student: { fullName: report.student.fullName, studentId: report.student.studentId, program: report.student.program, requiredHours: report.student.requiredHours },
    selectedDates: (report.range.scope === 'complete' ? 'Complete OJT · ' : '') + exportDate(report.range.from) + (report.range.to === report.range.from ? '' : ' to ' + exportDate(report.range.to)),
    selectedHours: duration(report.selectedRangeCompletedSeconds), totalHours: duration(report.lifetimeCompletedSeconds),
    generatedAt: activityDate(now) + ' · ' + activityTime(now) + ' Asia/Manila', days,
    unavailablePhotos }
}
export function buildJournalPdf(report, logo = null) {
  requireJournalActivities(report)
  const content = []
  if (logo) content.push({ image: logo, fit: [48, 48], margin: [0, 0, 0, 6] })
  content.push({ text: 'BSIT / TCC', style: 'brand' }, { text: 'OJT Journal', style: 'title' },
    { text: report.student.fullName, style: 'name' },
    { text: `Student ID: ${report.student.studentId}\nProgram: ${report.student.program}\nRequired OJT Hours: ${report.student.requiredHours}\nSelected dates: ${report.selectedDates}\nTimezone: Asia/Manila`, margin: [0, 6, 0, 8] },
    { text: `Selected Journal Completed Hours: ${report.selectedHours}\nTotal Completed OJT Hours (all dates): ${report.totalHours}`, margin: [0, 0, 0, 12] })
  for (const day of report.days) {
    content.push({ text: `${day.date} · Completed: ${day.completed}`, style: 'day', headlineLevel: 1 })
    if (!day.activities.length) content.push({ text: JOURNAL_EMPTY_ACTIVITY_MESSAGE, style: 'note' })
    for (const a of day.activities) {
      // A table heading repeats if an unusually long entry spans pages.
      content.push({ table: { widths: ['*'], headerRows: 1, keepWithHeaderRows: 1, body: [
        [{ text: `${a.time} · ${a.category}${a.edited ? ' · Edited' : ''}`, bold: true }],
        [{ text: a.description, preserveLeadingSpaces: true }],
      ] }, layout: 'noBorders', margin: [0, 4, 0, 4] })
      if (a.photo) content.push({ unbreakable: true, stack: [{ image: a.photo.data, fit: [440, 230] }, { text: `Activity proof · ${a.time} · ${a.category}`, fontSize: 8, margin: [0, 3, 0, 0] }], margin: [0, 2, 0, 10] })
      if (a.photoNote) content.push({ text: a.photoNote, style: 'note' })
    }
    if (day.sessions.length) {
      content.push({ unbreakable: true, stack: [{ text: `Attendance summary · ${day.date}`, bold: true, margin: [0, 8, 0, 3] }, { table: { headerRows: 1, widths: [55, '*', '*'], body: [
        ['Session', 'Time In', 'Time Out'], ...day.sessions.map(s => [String(s.ordinal), s.timeIn, s.timeOut]),
      ] }, layout: 'lightHorizontalLines' }] })
    }
    content.push({ text: `Daily completed time: ${day.completed}. Completed sessions only; breaks and ongoing sessions excluded.`, style: 'note' })
  }
  return { pageSize: 'A4', pageMargins: [42, 45, 42, 48], defaultStyle: { font: 'Roboto', fontSize: 10, lineHeight: 1.25 },
    info: { title: 'OJT Journal', author: report.student.fullName }, content,
    header: { text: 'BSIT / TCC · OJT Journal', margin: [42, 18, 42, 0], fontSize: 8, color: '#555555' },
    footer: (page, pages) => ({ columns: [{ text: `Generated: ${report.generatedAt}`, fontSize: 7 }, { text: `${page} / ${pages}`, alignment: 'right', fontSize: 8 }], margin: [42, 15, 42, 0] }),
    styles: { brand: { fontSize: 11, bold: true }, title: { fontSize: 23, bold: true, margin: [0, 4, 0, 10] }, name: { fontSize: 14, bold: true }, day: { fontSize: 13, bold: true, margin: [0, 14, 0, 7] }, note: { fontSize: 9, color: '#555555', margin: [0, 4, 0, 8] } },
    pageBreakBefore(node, container) { return node.headlineLevel === 1 && container.getFollowingNodesOnPage().length === 0 },
  }
}
