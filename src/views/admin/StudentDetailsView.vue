<script>
import { ArrowLeft, UserRound } from 'lucide-vue-next'
import AdminRecords from '../../components/AdminRecords.vue'
import adminSummaryMixin from '../../services/adminSummaryMixin.js'
import { hours, progress } from '../../services/supabaseAdmin.js'
import { activityDate, activityTime } from '../../services/supabaseActivityData.js'
export default {
  name: 'StudentDetailsView', props: { id: { type: String, required: true } }, mixins: [adminSummaryMixin], components: { AdminRecords, ArrowLeft, UserRound },
  data() { return { activeTab: 'overview', tabs: ['overview','attendance','activities'] } },
  watch: { id() { this.activeTab = 'overview' } }, methods: { hours, progress, activityDate, activityTime },
}
</script>
<template><div class="space-y-6"><RouterLink to="/admin/students" class="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand"><ArrowLeft :size="16" />Back to Students</RouterLink>
  <div class="flex flex-wrap items-center justify-between gap-2"><h1 class="text-2xl font-semibold sm:text-3xl">Student Details</h1><button type="button" :disabled="loading" class="min-h-11 px-3 text-sm font-semibold text-brand" @click="refresh">Refresh profile</button></div>
  <p v-if="loading" role="status">Loading student…</p><p v-if="error" role="alert" class="text-sm text-brand">{{ error }}</p><p v-if="!loading && !error && !result" class="rounded-xl border bg-white p-6">Student not found.</p>
  <template v-if="result"><section class="rounded-xl border border-stone-200 bg-white p-5 sm:p-6"><div class="flex flex-wrap items-center gap-4"><UserRound :size="32" class="text-brand" /><div class="min-w-0"><h2 class="break-words text-xl font-semibold">{{ result.full_name }}</h2><p class="mt-1 text-sm text-stone-500">{{ result.student_id }} · {{ result.status }}</p></div><span class="rounded-full bg-stone-100 px-3 py-1 text-xs">{{ result.open_time_in ? 'IN' : 'OUT' }}</span></div></section>
  <nav aria-label="Student detail sections" class="flex flex-wrap gap-2"><button v-for="tab in tabs" :key="tab" type="button" :aria-pressed="activeTab === tab" class="min-h-11 rounded-lg border px-4 text-sm capitalize" :class="activeTab === tab ? 'border-brand bg-brand text-white' : 'border-stone-200 bg-white text-stone-600'" @click="activeTab = tab">{{ tab }}</button></nav>
  <section v-if="activeTab === 'overview'" class="rounded-xl border border-stone-200 bg-white p-5 sm:p-6"><h2 class="text-lg font-semibold">OJT Overview</h2><dl class="mt-5 grid gap-5 sm:grid-cols-2"><div><dt class="text-sm text-stone-500">Email</dt><dd class="break-all">{{ result.email }}</dd></div><div><dt class="text-sm text-stone-500">Program</dt><dd>{{ result.program }}</dd></div><div><dt class="text-sm text-stone-500">Completed OJT hours</dt><dd>{{ hours(result.completed_seconds) }} / {{ result.required_hours }}h</dd></div><div><dt class="text-sm text-stone-500">Completed sessions</dt><dd>{{ result.completed_sessions }}</dd></div><div v-if="result.open_time_in"><dt class="text-sm text-stone-500">Current Time In</dt><dd>{{ activityDate(result.open_time_in) }} · {{ activityTime(result.open_time_in) }}</dd></div></dl><progress class="mt-5 h-2 w-full accent-brand" :value="progress(result)" max="100" aria-label="Completed OJT progress"></progress><p class="mt-2 text-xs text-stone-500">Only completed server attendance sessions count toward accumulated hours.</p></section>
  <AdminRecords v-if="activeTab === 'attendance'" :key="id + ':attendance'" kind="attendance" :student-id="id" /><AdminRecords v-if="activeTab === 'activities'" :key="id + ':activities'" kind="activities" :student-id="id" />
  </template></div></template>
