<script>
import studentAttendanceMixin from '../../services/studentAttendanceMixin.js'
import AttendanceFeedback from '../../components/AttendanceFeedback.vue'
import ActivityFeed from '../../components/ActivityFeed.vue'
import { Plus, ArrowRight, Clock3, CalendarDays, GraduationCap, LogIn, LogOut } from 'lucide-vue-next'

export default {
  name: 'StudentDashboard',
  mixins: [studentAttendanceMixin],
  components: { AttendanceFeedback, ActivityFeed, Plus, ArrowRight, Clock3, CalendarDays, GraduationCap, LogIn, LogOut },

}
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-brand">Your OJT overview</p>
        <h1 class="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">Welcome, {{ attendanceDisplay.studentName }}</h1>
        <p class="mt-2 flex items-center gap-2 text-sm text-stone-500"><CalendarDays :size="16" class="shrink-0" aria-hidden="true" />{{ attendanceDisplay.date }}</p>
      </div>
      <RouterLink to="/student/activity" class="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-dark">
        <Plus :size="18" aria-hidden="true" />Add Activity Update
      </RouterLink>
    </header>

    <p class="border-l-2 border-brand-gold pl-3 text-xs leading-5 text-stone-500">Attendance, completed hours and recent activity updates come from your records.</p>

    <AttendanceFeedback :state="attendanceUi" @refresh="refreshAttendance" />
    <section aria-label="OJT summary" class="grid gap-4 md:grid-cols-3">
      <article class="rounded-xl border border-stone-200 bg-white p-5">
        <h2 class="text-xs font-semibold uppercase tracking-wider text-stone-500">Current Status</h2>
        <p class="mt-4 flex items-center gap-3 text-3xl font-semibold text-stone-900">
          <span class="h-2.5 w-2.5 rounded-full" :class="attendanceDisplay.status === 'IN' ? 'bg-emerald-600' : 'bg-stone-400'" aria-hidden="true"></span>{{ attendanceDisplay.status }}
        </p>
        <p class="mt-2 text-sm text-stone-500">{{ attendanceDisplay.statusNote }}</p>
      </article>
      <article class="rounded-xl border border-stone-200 bg-white p-5">
        <div class="flex items-center justify-between gap-2"><h2 class="text-xs font-semibold uppercase tracking-wider text-stone-500">Today's Completed Hours</h2><Clock3 :size="18" class="text-brand" aria-hidden="true" /></div>
        <p class="mt-4 text-3xl font-semibold tracking-tight text-stone-900">{{ attendanceDisplay.todayHours }}</p>
        <p class="mt-2 text-sm text-stone-500">Today</p>
      </article>
      <article class="rounded-xl border border-stone-200 bg-white p-5">
        <div class="flex items-center justify-between gap-2"><h2 class="text-xs font-semibold uppercase tracking-wider text-stone-500">Total OJT Hours</h2><GraduationCap :size="18" class="text-brand" aria-hidden="true" /></div>
        <p class="mt-4 text-3xl font-semibold tracking-tight text-stone-900">{{ attendanceDisplay.totalHours }}</p>
        <p class="mt-2 text-sm text-stone-500">{{ attendanceDisplay.requiredHours }} hours required</p>
        <div v-if="attendanceDisplay.progressPercent !== null" role="progressbar" aria-label="OJT hours completed" :aria-valuenow="attendanceDisplay.progressPercent" aria-valuemin="0" aria-valuemax="100" class="mt-4 h-1.5 overflow-hidden rounded-full bg-stone-100">
          <div class="h-full rounded-full bg-brand-gold" :style="{ width: attendanceDisplay.progressPercent + '%' }"></div>
        </div>
        <p class="mt-2 text-xs text-stone-500">{{ attendanceDisplay.progressPercent === null ? 'Progress unavailable' : attendanceDisplay.progressPercent + '% complete' }} · {{ attendanceDisplay.remainingHours }} remaining</p>
      </article>
    </section>

    <div class="grid items-start gap-6 xl:grid-cols-5">
      <section aria-labelledby="attendance-heading" class="rounded-xl border border-stone-200 bg-white p-5 sm:p-6 xl:col-span-2">
        <h2 id="attendance-heading" class="text-lg font-semibold text-stone-900">Today's Attendance</h2>
        <p class="mt-1 text-sm text-stone-500">{{ attendanceDisplay.carriedOver ? 'Open session from ' + attendanceDisplay.sessionDate + ' (Asia/Manila)' : 'Your attendance today (Asia/Manila).' }}</p>
        <dl class="mt-5 divide-y divide-stone-100">
          <div class="flex items-center justify-between gap-3 py-4"><dt class="flex items-center gap-3 text-sm text-stone-500"><LogIn :size="18" aria-hidden="true" />Time In</dt><dd class="font-semibold text-stone-800">{{ attendanceDisplay.timeIn }}</dd></div>
          <div class="flex items-center justify-between gap-3 py-4"><dt class="flex items-center gap-3 text-sm text-stone-500"><LogOut :size="18" aria-hidden="true" />Time Out</dt><dd class="font-semibold text-stone-800">{{ attendanceDisplay.timeOut }}</dd></div>
          <div class="flex items-center justify-between gap-3 py-4"><dt class="text-sm text-stone-500">Current status</dt><dd class="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold" :class="attendanceDisplay.status === 'IN' ? 'bg-emerald-50 text-emerald-800' : 'bg-stone-100 text-stone-600'"><span class="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true"></span>{{ attendanceDisplay.status }}</dd></div>
        </dl>
        <RouterLink to="/student/attendance" class="mt-4 flex min-h-11 items-center justify-center gap-2 rounded-lg border border-stone-200 px-4 py-3 text-sm font-semibold text-brand hover:bg-stone-50">View Attendance<ArrowRight :size="16" aria-hidden="true" /></RouterLink>
      </section>

      <section aria-labelledby="activity-heading" class="rounded-xl border border-stone-200 bg-white p-5 sm:p-6 xl:col-span-3">
        <h2 id="activity-heading" class="text-lg font-semibold text-stone-900">Recent Activity</h2>
        <ActivityFeed recent />
      </section>
    </div>
  </div>
</template>
