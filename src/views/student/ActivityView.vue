<script>
import { CalendarDays } from 'lucide-vue-next'
import ActivityEditor from '../../components/ActivityEditor.vue'
import AttendanceFeedback from '../../components/AttendanceFeedback.vue'
import studentAttendanceMixin from '../../services/studentAttendanceMixin.js'
export default {
  name: 'ActivityView', components: { CalendarDays, ActivityEditor, AttendanceFeedback },
  mixins: [studentAttendanceMixin],
}
</script>
<template>
  <div class="space-y-6">
    <header><h1 class="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">Activity Update</h1><p class="mt-2 text-sm leading-6 text-stone-600">Share your current OJT activity and photo proof.</p><p class="mt-3 flex items-center gap-2 text-sm text-stone-500"><CalendarDays :size="16" aria-hidden="true" />{{ currentDate }}</p></header>
    <p class="border-l-2 border-brand-gold pl-3 text-xs leading-5 text-stone-500">Submit while Timed In. Photos stay private; submission dates and times come from the server.</p>
    <AttendanceFeedback :state="attendanceUi" @refresh="refreshAttendance" />
    <p class="text-sm text-stone-600">Current status: <strong>{{ attendanceDisplay.status }}</strong> · Time In: {{ attendanceDisplay.timeIn }}</p>
    <ActivityEditor :open-attendance="attendanceUi.ready && attendanceDisplay.status === 'IN'" :attendance-loading="attendanceUi.loading" @saved="refreshAttendance" />
    <RouterLink :to="{ path: '/student/history', query: { tab: 'activity' } }" class="inline-flex min-h-11 items-center text-sm font-semibold text-brand">View activity history</RouterLink>
  </div>
</template>
