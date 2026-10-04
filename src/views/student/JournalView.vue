<script>
import { BookOpen } from 'lucide-vue-next'
import JournalActivityProof from '../../components/JournalActivityProof.vue'
import { createStudentJournalReader } from '../../services/supabaseJournal.js'
import { journalPageState, createJournalPageController } from '../../services/journalPageController.js'
import { activityAccountKey, approvedActivityStudent } from '../../services/supabaseActivities.js'
import { activityDate, activityTime } from '../../services/supabaseActivityData.js'
import { duration } from '../../services/supabaseAttendancePresentation.js'
import { journalDay, canExportJournal, JOURNAL_EMPTY_ACTIVITY_MESSAGE } from '../../services/journalReportModel.js'
import { journalExportState } from '../../services/journalExportController.js'
import { createStudentJournalExporter } from '../../services/journalExport.js'
export default {
  name: 'JournalView', components: { BookOpen, JournalActivityProof },
  data() { return { journal: journalPageState(), controller: null, exporter: null, exportState: journalExportState(), includePhotos: true, emptyActivityMessage: JOURNAL_EMPTY_ACTIVITY_MESSAGE } },
  computed: {
    accountKey() { return activityAccountKey() },
    visibleDays() { return this.journal.report?.days || [] },
    canExport() { return canExportJournal(this.journal.report) },
  },
  watch: { accountKey() { this.start() } },
  mounted() { this.start() },
  beforeUnmount() { this.exporter?.cancel(); this.controller?.clear() },
  methods: {
    activityTime, duration,
    dateLabel(day) { return activityDate(day + 'T00:00:00+08:00') },
    timeOut(session, day) {
      if (!session.timeOut) return 'Ongoing'
      return journalDay(session.timeOut) === day ? activityTime(session.timeOut) : `${activityDate(session.timeOut)} · ${activityTime(session.timeOut)}`
    },
    proofPath(activity) { return this.journal.report?.internal.sources[activity.sourceIndex]?.proofPath || '' },
    start() {
      this.exporter?.cancel()
      this.exporter = createStudentJournalExporter(this.exportState, () => this.journal.report)
      this.controller?.clear()
      const key = this.accountKey
      this.controller = createJournalPageController(this.journal, createStudentJournalReader(), () => approvedActivityStudent() && this.accountKey === key)
      this.controller.load()
    },
    changeMode(mode) { if (this.journal.mode !== mode) { this.journal.mode = mode; this.exporter?.cancel(); this.controller?.clear(); if(mode === 'complete') this.controller?.load() } },
    selectionChanged() { this.exporter?.cancel(); this.controller?.clear() },
    load() { this.exporter?.cancel(); this.controller?.load() },
    exportReport(kind) { this.exporter?.run(kind, this.includePhotos) },
    cancelExport() { this.exporter?.cancel() },
  },
}
</script>
<template>
  <div class="space-y-6">
    <header><h1 class="flex items-center gap-3 text-2xl font-semibold text-stone-900 sm:text-3xl"><BookOpen :size="26" aria-hidden="true" />OJT Journal</h1><p class="mt-2 text-sm leading-6 text-stone-600">Review the activities you recorded during your OJT.</p></header>
    <form class="rounded-xl border border-stone-200 bg-white p-4 sm:p-6" @submit.prevent="load">
      <fieldset><legend class="text-sm font-semibold text-stone-700">Journal scope</legend>
        <div class="mt-3 flex flex-wrap gap-2"><button v-for="scope in [{id:'daily',label:'Daily'},{id:'range',label:'Date Range'},{id:'complete',label:'Complete OJT'}]" :key="scope.id" type="button" :aria-pressed="journal.mode === scope.id" class="min-h-12 rounded-lg border px-5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand" :class="journal.mode === scope.id ? 'border-brand bg-brand text-white' : 'border-stone-300 text-stone-700'" @click="changeMode(scope.id)">{{ scope.label }}</button></div>
        <div v-if="journal.mode !== 'complete'" class="mt-4 grid gap-4 sm:grid-cols-2"><label class="min-w-0 text-sm font-medium text-stone-700">{{ journal.mode === 'daily' ? 'Journal date' : 'From' }}<input v-model="journal.from" type="date" min="2000-01-01" max="2100-12-31" aria-describedby="journal-range-help" class="mt-2 min-h-12 w-full min-w-0 rounded-lg border border-stone-300 bg-white p-3 focus-visible:outline-2 focus-visible:outline-brand" @input="selectionChanged" /></label><label v-if="journal.mode === 'range'" class="min-w-0 text-sm font-medium text-stone-700">To<input v-model="journal.to" type="date" min="2000-01-01" max="2100-12-31" aria-describedby="journal-range-help" class="mt-2 min-h-12 w-full min-w-0 rounded-lg border border-stone-300 bg-white p-3 focus-visible:outline-2 focus-visible:outline-brand" @input="selectionChanged" /></label></div>
      </fieldset>
      <p v-if="journal.mode !== 'complete'" id="journal-range-help" class="mt-3 text-xs leading-5 text-stone-500">Dates and official activity times use Asia/Manila. Date ranges may cover up to 31 calendar days, including both dates.</p>
      <p v-if="journal.mode === 'complete'" class="mt-3 text-xs text-stone-500">Complete OJT uses your recorded Activity dates and Attendance Time In dates. Required hours do not limit the period.</p>
      <button type="submit" :disabled="journal.loading" class="mt-4 min-h-12 rounded-lg bg-brand px-5 py-3 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50">{{ journal.loading ? 'Loading journal…' : journal.report ? 'Refresh journal' : 'Load journal' }}</button>
    </form>
    <p v-if="journal.loading" role="status" class="text-sm text-stone-600">{{ journal.mode === 'complete' ? 'Preparing Complete OJT Journal…' : 'Loading your selected journal records…' }}</p>
    <p v-if="journal.error" role="alert" class="rounded-lg border border-brand-gold/50 bg-brand-gold/10 p-4 text-sm">{{ journal.error }}</p>
    <section v-if="canExport" aria-label="Journal export" class="rounded-xl border border-stone-200 bg-white p-4 sm:p-6">
      <h2 class="text-lg font-semibold">Export journal</h2>
      <label class="mt-3 flex min-h-11 items-center gap-3 text-sm"><input v-model="includePhotos" type="checkbox" :disabled="exportState.busy" class="h-5 w-5 accent-brand" />Include Activity Photos</label>
      <div class="mt-3 flex flex-wrap gap-3"><button type="button" :disabled="exportState.busy" class="min-h-12 rounded-lg bg-brand px-4 text-sm font-semibold text-white disabled:opacity-50" @click="exportReport('pdf')">Download PDF</button><button type="button" :disabled="exportState.busy" class="min-h-12 rounded-lg border border-stone-300 px-4 text-sm font-semibold text-brand disabled:opacity-50" @click="exportReport('docx')">Download Word (.docx)</button><button type="button" :disabled="exportState.busy" class="min-h-12 rounded-lg border border-stone-300 px-4 text-sm font-semibold text-brand disabled:opacity-50" @click="exportReport('print')">Print</button><button v-if="exportState.busy" type="button" class="min-h-12 rounded-lg border px-4 text-sm" @click="cancelExport">Cancel export</button></div>
      <p v-if="exportState.progress" role="status" class="mt-3 text-sm text-stone-600">{{ exportState.progress }}</p><p v-if="exportState.notice" role="status" class="mt-3 text-sm text-stone-600">{{ exportState.notice }}</p><p v-if="exportState.error" role="alert" class="mt-3 text-sm text-brand">{{ exportState.error }}</p>
    </section>
    <section v-if="journal.report" aria-label="Journal preview" class="space-y-5">
      <header class="rounded-xl border border-stone-200 bg-white p-4 sm:p-6"><h2 class="text-xl font-semibold text-stone-900">{{ journal.report.student.fullName }}</h2><dl class="mt-4 grid gap-4 text-sm sm:grid-cols-2"><div><dt class="text-stone-500">Student ID</dt><dd>{{ journal.report.student.studentId }}</dd></div><div><dt class="text-stone-500">Program</dt><dd>{{ journal.report.student.program }}</dd></div><div><dt class="text-stone-500">Required OJT Hours</dt><dd>{{ journal.report.student.requiredHours }} hours</dd></div><div><dt class="text-stone-500">{{ journal.report.range.scope === 'complete' ? 'Complete OJT Period' : 'Selected journal dates' }}</dt><dd><template v-if="journal.report.range.from">{{ dateLabel(journal.report.range.from) }}<template v-if="journal.report.range.to !== journal.report.range.from"> – {{ dateLabel(journal.report.range.to) }}</template></template><template v-else>No recorded OJT period yet.</template></dd></div></dl><dl class="mt-5 grid gap-4 border-t border-stone-100 pt-4 sm:grid-cols-2"><div><dt class="text-xs text-stone-500">{{ journal.mode === 'complete' ? 'Completed OJT Hours' : journal.mode === 'daily' ? 'Selected Day Completed Hours' : 'Selected Range Completed Hours' }}</dt><dd class="mt-1 text-lg font-semibold">{{ duration(journal.report.selectedRangeCompletedSeconds) }}</dd></div><div v-if="journal.report.lifetimeCompletedSeconds != null"><dt class="text-xs text-stone-500">Total Completed OJT Hours · All dates</dt><dd class="mt-1 text-lg font-semibold">{{ duration(journal.report.lifetimeCompletedSeconds) }}</dd></div></dl></header>
      <p v-if="journal.mode === 'complete'" class="text-sm text-stone-600">Total Activities recorded: {{ journal.report.days.reduce((total, day) => total + day.activities.length, 0) }}</p>
      <article v-for="day in visibleDays" :key="day.date" class="min-w-0 rounded-xl border border-stone-200 bg-white p-4 sm:p-6"><h3 class="text-lg font-semibold text-stone-900">{{ dateLabel(day.date) }}</h3>
        <ol v-if="day.activities.length" class="mt-4 divide-y divide-stone-100"><li v-for="activity in day.activities" :key="activity.sourceIndex" class="py-4"><div class="flex flex-wrap items-center gap-2 text-xs text-stone-500"><time :datetime="activity.createdAt">{{ activityTime(activity.createdAt) }}</time><span v-if="activity.edited" class="rounded bg-stone-100 px-2 py-1">Edited</span></div><h4 class="mt-2 text-sm font-semibold text-brand">{{ activity.category }}</h4><p class="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-stone-700">{{ activity.description }}</p><JournalActivityProof :path="proofPath(activity)" /></li></ol>
        <p v-else class="mt-4 text-sm text-stone-600">{{ emptyActivityMessage }}</p>
        <section v-if="day.sessions.length" aria-label="Attendance summary" class="mt-4 border-t border-stone-100 pt-4"><h4 class="text-sm font-semibold">Attendance summary</h4><div class="mt-3 grid gap-3 sm:grid-cols-2"><section v-for="session in day.sessions" :key="session.ordinal" class="rounded-lg bg-stone-50 p-3"><h5 class="text-sm font-semibold">Session {{ session.ordinal }}</h5><dl class="mt-2 space-y-2 text-sm"><div><dt class="text-xs text-stone-500">Time In</dt><dd>{{ activityTime(session.timeIn) }}</dd></div><div><dt class="text-xs text-stone-500">Time Out</dt><dd>{{ timeOut(session, day.date) }}</dd></div></dl></section></div><p class="mt-3 text-sm">Daily completed time: <strong>{{ duration(day.completedSeconds) }}</strong></p><p class="mt-1 text-xs text-stone-500">Completed sessions only; breaks and ongoing sessions do not count.</p></section>
      </article>
    </section>
    <aside class="rounded-xl border border-stone-200 bg-stone-50 p-4" aria-labelledby="journal-ai-title"><div class="flex flex-wrap items-center gap-2"><h2 id="journal-ai-title" class="text-sm font-semibold">AI Journal Generator</h2><span class="rounded-full border border-stone-300 px-2 py-1 text-xs">Coming Soon</span></div><p class="mt-2 text-sm text-stone-600">Optional AI-assisted drafting is planned for a future update.</p><button type="button" disabled class="mt-3 min-h-11 rounded-lg border border-stone-300 px-4 text-sm text-stone-500">Generate AI Journal · Coming Soon</button></aside>
  </div>
</template>
