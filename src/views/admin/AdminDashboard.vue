<script>
import { CalendarDays, Users, LogIn, ClipboardList, Clock3 } from 'lucide-vue-next'
import AdminRecentActivities from '../../components/AdminRecentActivities.vue'
import AdminRecords from '../../components/AdminRecords.vue'
import adminSummaryMixin from '../../services/adminSummaryMixin.js'
import { hours } from '../../services/supabaseAdmin.js'
export default {
  name: 'AdminDashboard', mixins: [adminSummaryMixin], components: { AdminRecentActivities, AdminRecords, CalendarDays, Users, LogIn, ClipboardList, Clock3 },
  computed: { stats() { return this.result ? [
    { label: 'Total Students', value: this.result.total, icon: 'Users' },
    { label: 'Approved Students', value: this.result.approved, icon: 'Users' },
    { label: 'Pending Students', value: this.result.pending, icon: 'ClipboardList' },
    { label: 'Rejected Students', value: this.result.rejected, icon: 'Users' },
    { label: 'Currently IN', value: this.result.timed_in, icon: 'LogIn' },
    { label: 'Completed Sessions', value: this.result.completed_sessions, icon: 'ClipboardList' },
    { label: 'Completed OJT Hours', value: hours(this.result.completed_seconds), icon: 'Clock3' },
  ] : [] } },
}
</script>
<template>
  <div class="space-y-6"><header><p class="mb-2 text-xs font-semibold uppercase tracking-wider text-brand">Class overview</p><h1 class="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">Admin Dashboard</h1><p class="mt-2 text-sm leading-6 text-stone-600">Monitor student attendance and OJT activity.</p></header>
    <div class="flex items-center justify-between gap-3"><p class="text-xs text-stone-500">Completed hours exclude open sessions.</p><button type="button" :disabled="loading" class="min-h-11 px-3 text-sm font-semibold text-brand" @click="refresh">Refresh summary</button></div>
    <p v-if="loading" role="status">Loading summary…</p><p v-if="error" role="alert" class="text-sm text-brand">{{ error }}</p>
    <section aria-label="Class summary" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><article v-for="stat in stats" :key="stat.label" class="rounded-xl border border-stone-200 bg-white p-5"><div class="flex items-start justify-between gap-3"><h2 class="text-xs font-semibold uppercase leading-5 tracking-wider text-stone-500">{{ stat.label }}</h2><component :is="stat.icon" :size="18" class="shrink-0 text-brand" /></div><p class="mt-4 text-3xl font-semibold text-stone-900">{{ stat.value }}</p></article></section>
    <div class="grid items-start gap-6 xl:grid-cols-2"><section class="min-w-0 rounded-xl border border-stone-200 bg-white p-5"><h2 class="text-lg font-semibold">Student Status</h2><p class="mt-1 text-xs text-stone-500">A bounded directory snapshot. Use the directory to filter IN/OUT.</p><AdminRecords kind="students" recent /><RouterLink to="/admin/students" class="mt-4 flex min-h-11 items-center justify-center rounded-lg border px-4 text-sm font-semibold text-brand">View All Students</RouterLink></section><section class="min-w-0 rounded-xl border border-stone-200 bg-white p-5"><h2 class="text-lg font-semibold">Recent Activity</h2><AdminRecentActivities /><RouterLink to="/admin/activity" class="mt-4 flex min-h-11 items-center justify-center rounded-lg border px-4 text-sm font-semibold text-brand">View Activity Monitor</RouterLink></section></div>
    <section v-if="result" class="rounded-xl border border-stone-200 bg-white p-5"><h2 class="text-lg font-semibold">Needs Attention</h2><p class="mt-3 border-l-2 border-brand-gold pl-3 text-sm">{{ result.pending }} registrations awaiting review.</p></section>
  </div>
</template>
