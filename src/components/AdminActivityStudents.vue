<script>
import { adminAttendanceSignals } from '../services/adminAttendanceSignals.js'

import { ChevronDown, ChevronUp, RefreshCw } from 'lucide-vue-next'
import AdminRecords from './AdminRecords.vue'
import { adminApi, adminKey } from '../services/supabaseAdmin.js'
import { adminPageState, createAdminPage } from '../services/adminPageController.js'
import { ACTIVITY_CATEGORIES, activityDate, activityTime } from '../services/supabaseActivityData.js'
export default {
  name: 'AdminActivityStudents', components: { AdminRecords, ChevronDown, ChevronUp, RefreshCw },
  props: { viewMode: { type: String, default: 'current' } },
  data() { return { state: adminPageState(), controller: null, removeAttendanceSignal: null, opened: null, search: '', category: '', attendance: '', day: '', categories: ACTIVITY_CATEGORIES } },
  computed: {
    identity() { return adminKey() },
    filters() { return { search: this.search, category: this.category, attendance: this.attendance, day: this.day } },
    queryKey() { return JSON.stringify(this.filters) },
    activityFiltered() { return !!(this.category || this.day) },
  },
  watch: {
    identity() { this.search = ''; this.category = ''; this.attendance = ''; this.day = ''; this.start() },
    queryKey() { this.start() },
  },
  mounted() { if (this.viewMode === 'current') this.removeAttendanceSignal = adminAttendanceSignals.register(() => this.controller?.reload()); this.start(); window.addEventListener('focus', this.refresh) },
  beforeUnmount() { this.removeAttendanceSignal?.(); this.controller?.stop(); this.opened = null; window.removeEventListener('focus', this.refresh) },
  methods: {
    activityDate, activityTime,
    start() { this.controller?.stop(); this.opened = null; this.state = adminPageState(); this.controller = createAdminPage(this.state, this.load, () => this.identity); return this.controller.refresh() },
    refresh() { this.opened = null; return this.controller?.refresh() },
    page(direction) { this.opened = null; return this.controller?.[direction]() },
    toggle(id) { this.opened = this.opened === id ? null : id },
    load(cursor, size) { return adminApi.activityStudents({ page_size: size, after_id: cursor?.id || null, search: this.search,
      category_filter: this.category, attendance_status: this.attendance, on_day: this.day || null }) },
  },
}
</script>
<template>
  <section class="space-y-4" aria-label="Student activity monitor">
    <div class="grid gap-3 rounded-xl border border-stone-200 bg-white p-4 sm:grid-cols-2 xl:grid-cols-4">
      <label class="text-sm">Search student<input v-model="search" maxlength="100" type="search" placeholder="Name or Student ID" class="mt-2 min-h-11 w-full rounded-lg border border-stone-300 p-3" /></label>
      <label class="text-sm">Activity type<select v-model="category" class="mt-2 min-h-11 w-full rounded-lg border border-stone-300 p-3"><option value="">All activities</option><option v-for="item in categories" :key="item">{{ item }}</option></select></label>
      <label class="text-sm">Current attendance<select v-model="attendance" class="mt-2 min-h-11 w-full rounded-lg border border-stone-300 p-3"><option value="">All</option><option>IN</option><option>OUT</option></select></label>
      <label class="text-sm">Submission date · Manila<input v-model="day" type="date" class="mt-2 min-h-11 w-full rounded-lg border border-stone-300 p-3" /></label>
    </div>
    <div class="flex flex-wrap items-center justify-between gap-3"><p class="text-xs leading-5 text-stone-500">25 students per page · Totals are all-time; matching counts follow the filters.</p><button type="button" :disabled="state.loading" class="inline-flex min-h-11 items-center gap-2 px-3 text-sm font-semibold text-brand disabled:opacity-50" @click="refresh"><RefreshCw :size="16" aria-hidden="true" />Refresh</button></div>
    <p v-if="state.loading" role="status" class="p-4 text-sm text-stone-500">Loading students…</p>
    <p v-if="state.error" role="alert" class="rounded-lg border border-brand-gold/50 bg-brand-gold/10 p-4 text-sm">{{ state.error }}</p>
    <p v-if="!state.loading && !state.error && !state.rows.length" class="rounded-xl border bg-white p-6 text-sm text-stone-500">No students have activities matching these filters.</p>
    <ul class="space-y-4">
      <li v-for="student in state.rows" :key="student.id" :data-student-uid="student.id" class="min-w-0 rounded-xl border border-stone-200 bg-white p-5 sm:p-6">
        <div class="flex flex-wrap justify-between gap-3"><div class="min-w-0"><h2 class="break-words font-semibold">{{ student.full_name }}</h2><p class="mt-1 text-xs text-stone-500">{{ student.student_id }}</p></div><span v-if="viewMode === 'current'" class="self-start rounded-full px-3 py-1 text-xs font-medium" :class="student.is_in ? 'bg-emerald-50 text-emerald-800' : 'bg-stone-100 text-stone-600'">{{ student.is_in ? 'IN' : 'OUT' }}</span></div>
        <dl class="mt-4 flex flex-wrap gap-x-8 gap-y-3 text-sm"><div><dt class="text-xs text-stone-500">Total activities · all-time</dt><dd class="mt-1 font-semibold">{{ student.total_activities }}</dd></div><div v-if="viewMode === 'logs'"><dt class="text-xs text-stone-500">Total edits · all-time</dt><dd class="mt-1 font-semibold">{{ student.total_edits }}</dd></div><div v-if="activityFiltered"><dt class="text-xs text-stone-500">Matching activities</dt><dd class="mt-1 font-semibold">{{ student.matching_activities }}</dd></div></dl>
        <button type="button" :aria-expanded="opened === student.id" :aria-controls="'student-activities-' + student.id" class="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand" @click="toggle(student.id)"><component :is="opened === student.id ? 'ChevronUp' : 'ChevronDown'" :size="16" aria-hidden="true" />{{ viewMode === 'logs' ? (opened === student.id ? 'Hide Logs' : 'View Logs') : (opened === student.id ? 'Hide Activities' : 'View Activities') }}</button>
        <div v-if="opened === student.id" :id="'student-activities-' + student.id" class="mt-4 border-t border-stone-200 pt-4">
          <AdminRecords :key="student.id + ':' + identity + ':' + queryKey" kind="activities" :monitor-mode="viewMode" :student-id="student.id" :monitor-filters="filters" />
        </div>
      </li>
    </ul>
    <div class="flex flex-wrap items-center justify-between gap-3"><button type="button" :disabled="state.loading || state.page === 0" class="min-h-11 rounded-lg border px-4 text-sm text-brand disabled:opacity-40" @click="page('previous')">Previous students</button><span class="text-xs text-stone-500">Page {{ state.page + 1 }}</span><button type="button" :disabled="state.loading || !state.next" class="min-h-11 rounded-lg border px-4 text-sm text-brand disabled:opacity-40" @click="page('next')">Next students</button></div>
  </section>
</template>
