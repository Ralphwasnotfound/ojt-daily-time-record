<script>
import AttendanceDays from '../../components/AttendanceDays.vue'
import AttendanceProofViewer from '../../components/AttendanceProofViewer.vue'
import { withStudentProofAvailability } from '../../services/studentAttendanceProof.js'
import AttendanceFeedback from '../../components/AttendanceFeedback.vue'
import AttendanceVerification from '../../components/AttendanceVerification.vue'
import studentAttendanceMixin from '../../services/studentAttendanceMixin.js'
import { getDeferredAttendanceProof } from '../../services/attendanceProofController.js'
import { CalendarDays, Clock3 } from 'lucide-vue-next'
export default {
  name: 'AttendanceView',
  mixins: [studentAttendanceMixin],
  components: { AttendanceDays, AttendanceProofViewer, AttendanceFeedback, AttendanceVerification, CalendarDays, Clock3 },
  data() { return { verification: null, deferredVerification: null } },
  mounted() { this.restoreDeferredVerification() },
  watch: { attendanceAccountKey() { this.verification = null; this.restoreDeferredVerification() } },
  methods: {
    async loadProofAttendanceDays(args) {
      const uid = this.attendanceStudentUid
      return withStudentProofAvailability(await this.loadAttendanceDays(args), uid)
    },
    restoreDeferredVerification() { this.deferredVerification = getDeferredAttendanceProof(this.attendanceStudentUid) },
    submitAttendance() {
      if (this.verification) return
      const recovery = getDeferredAttendanceProof(this.attendanceStudentUid)
      if (recovery) {
        if (!this.attendanceEligible) return
        this.verification = { action: recovery.action, owner: this.attendanceStudentUid, recovery }
      } else {
        if (this.attendanceActionDisabled) return
        this.verification = { action: this.attendanceUi.state.next_action, owner: this.attendanceStudentUid }
      }
    },
    async attendanceVerified(receipt) {
      this.verification = null
      this.restoreDeferredVerification()
      await this.attendanceController?.confirmProof(receipt)
    },
    closeVerification() { this.verification = null; this.restoreDeferredVerification(); this.refreshAttendance() },
    deferVerification() { this.verification = null; this.restoreDeferredVerification() },
  },
}
</script>

<template>
  <div class="space-y-6">
    <header>
      <h1 class="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">Attendance</h1>
      <p class="mt-2 text-sm leading-6 text-stone-600">Track your daily OJT attendance and rendered hours.</p>
      <p class="mt-3 flex items-center gap-2 text-sm text-stone-500"><CalendarDays :size="16" class="shrink-0" aria-hidden="true" />{{ currentDate }}</p>
    </header>
    <p class="border-l-2 border-brand-gold pl-3 text-xs leading-5 text-stone-500">Attendance is recorded using server time. Dates and times are shown in Asia/Manila.</p>

    <AttendanceFeedback :state="attendanceUi" @refresh="refreshAttendance" />
    <p v-if="deferredVerification" role="status" class="rounded-lg border border-brand-gold/50 bg-brand-gold/10 p-4 text-sm leading-6">Your previous verification is unresolved. No new punch will be started. Use Resolve previous verification when connected. Keep this tab open without reloading until resolved.</p>
    <section aria-labelledby="today-heading" class="rounded-xl border border-stone-200 bg-white p-5 sm:p-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 id="today-heading" class="text-lg font-semibold text-stone-900">Today's Attendance</h2>
        <span class="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold" :class="attendanceDisplay.status === 'IN' ? 'bg-emerald-50 text-emerald-800' : 'bg-stone-100 text-stone-600'"><span class="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true"></span>CURRENTLY {{ attendanceDisplay.status }}</span>
      </div>
      <p v-if="attendanceDisplay.carriedOver" class="mt-3 text-sm text-amber-800">Open session started {{ attendanceDisplay.sessionDate }} (Asia/Manila). It has not been automatically closed.</p><p class="mt-3 text-sm text-stone-600">{{ attendanceDisplay.statusNote }}</p><div class="mt-5">
        <div>
          <dl class="grid gap-4 sm:grid-cols-3">
            <div class="rounded-lg bg-stone-50 p-4"><dt class="text-xs text-stone-500">Time In</dt><dd class="mt-2 text-lg font-semibold text-stone-900">{{ attendanceDisplay.timeIn }}</dd></div>
            <div class="rounded-lg bg-stone-50 p-4"><dt class="text-xs text-stone-500">Time Out</dt><dd class="mt-2 text-lg font-semibold text-stone-900">{{ attendanceDisplay.timeOut }}</dd></div>
            <div class="rounded-lg bg-stone-50 p-4"><dt class="text-xs text-stone-500">Today's Completed Hours</dt><dd class="mt-2 text-lg font-semibold text-stone-900">{{ attendanceDisplay.todayHours }}</dd></div>
          </dl>
          <button type="button" :disabled="deferredVerification ? !attendanceEligible : attendanceActionDisabled" :aria-busy="attendanceUi.busy" class="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50" @click="submitAttendance"><Clock3 :size="18" aria-hidden="true" />{{ deferredVerification ? 'Resolve previous verification' : attendanceUi.busy ? 'Recording...' : attendanceDisplay.completedToday ? 'Completed for today' : attendanceUi.ready ? attendanceDisplay.action : 'Attendance unavailable' }}</button>
          <p class="mt-3 text-xs leading-5 text-stone-500">Up to two sessions may start per Manila day. Open sessions do not count toward completed hours.</p>
          <p class="mt-2 text-xs leading-5 text-stone-500">Each Time In and Time Out requires a live selfie and your current location.</p>
        </div>
      </div>
    </section>

    <dl class="grid gap-3 sm:grid-cols-3">
      <div v-for="item in attendanceSummary" :key="item.label" class="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-stone-200 px-4 py-3"><dt class="text-xs text-stone-500">{{ item.label }}</dt><dd class="text-sm font-semibold text-stone-800">{{ item.value }}</dd></div>
    </dl>

    <section aria-labelledby="history-heading" class="rounded-xl border border-stone-200 bg-white p-5 sm:p-6">
      <h2 id="history-heading" class="text-lg font-semibold text-stone-900">Attendance History</h2>
      <p class="mt-1 text-sm leading-6 text-stone-500">Your recorded attendance, newest first. Overnight sessions are grouped by their start date.</p>
      <AttendanceDays :identity="attendanceEligible ? attendanceAccountKey : ''" :load="loadProofAttendanceDays" :refresh-key="attendanceUi.state">
        <template #proof="{ session, action }"><div v-if="session.proofActions?.includes(action)"><AttendanceProofViewer audience="student" :student-uid="attendanceStudentUid" :session-id="session.id" :action="action" /></div></template>
      </AttendanceDays>
    </section>
    <AttendanceVerification v-if="verification" :action="verification.action" :owner="verification.owner"
      :eligible="attendanceEligible" :refresh="refreshAttendance" :recovery="verification.recovery" @saved="attendanceVerified" @close="closeVerification" @deferred="deferVerification" />
  </div>
</template>
