<script>
import { RefreshCw, History, ArrowRight } from 'lucide-vue-next'
import AdminActivityCard from './AdminActivityCard.vue'
import AdminActivityTimeline from './AdminActivityTimeline.vue'
import ExpandableList from './ExpandableList.vue'
import { adminApi, adminKey, hours, progress, revisionLabel } from '../services/supabaseAdmin.js'
import { adminPageState, createAdminPage } from '../services/adminPageController.js'
import { ACTIVITY_CATEGORIES, activityDate, activityTime } from '../services/supabaseActivityData.js'
import { formatAttendanceRows } from '../services/supabaseAttendancePresentation.js'
export default {
  name: 'AdminRecords', components: { AdminActivityTimeline, AdminActivityCard, ExpandableList, RefreshCw, History, ArrowRight },
  props: { kind: { type: String, required: true }, studentId: { type: String, default: null }, activityId: { type: String, default: null }, recent: Boolean, pageSize: { type: Number, default: 25 }, collapseRecords: { type: Boolean, default: true },
    monitorMode: { type: String, default: '' }, monitorFilters: { type: Object, default: null } },
  data() { return { state: adminPageState(), controller: null, search: '', status: '', attendance: '', category: '', day: '', opened: null, categories: ACTIVITY_CATEGORIES } },
  computed: { identity() { return adminKey() }, queryKey() { return [this.kind,this.studentId,this.activityId,this.search,this.status,this.attendance,this.category,this.day,JSON.stringify(this.monitorFilters)].join('|') },
    attendanceRows() { return formatAttendanceRows(this.state.rows) } },
  watch: { identity() { this.search = ''; this.status = ''; this.attendance = ''; this.category = ''; this.day = ''; this.start() }, queryKey() { this.start() } },
  mounted() { this.start(); window.addEventListener('focus', this.refresh) },
  beforeUnmount() { this.controller?.stop(); window.removeEventListener('focus', this.refresh) },
  methods: {
    hours, progress, revisionLabel, activityDate, activityTime,
    start() { this.controller?.stop(); this.opened = null; this.state = adminPageState(); this.controller = createAdminPage(this.state, this.load, () => this.identity, this.recent ? 3 : this.pageSize); this.controller.refresh() },
    refresh() { this.opened = null; return this.controller?.refresh() },
    load(cursor, size) {
      const shared = { page_size: size }
      if (this.kind === 'students') return adminApi.students({ ...shared, after_id: cursor?.id || null, search: this.search, account_status: this.status, attendance_status: this.attendance, category_filter: this.category })
      if (this.kind === 'attendance') return adminApi.attendance({ ...shared, target_uid: this.studentId, before_time_in: cursor?.time_in || null, before_id: cursor?.id || null })
      if (this.kind === 'revisions') return adminApi.revisions({ ...shared, target_activity: this.activityId, after_revision: cursor?.revision ?? -1 })
      return adminApi.activities({ ...shared, target_uid: this.studentId, before_created_at: cursor?.created_at || null, before_id: cursor?.id || null,
        search: this.monitorFilters?.search ?? this.search, category_filter: this.monitorFilters?.category ?? this.category,
        attendance_status: this.monitorFilters?.attendance ?? this.attendance, on_day: (this.monitorFilters?.day ?? this.day) || null })
    },
  },
}
</script>
<template>
  <section class="min-w-0 space-y-4">
    <div v-if="!recent && !monitorFilters && ['students','activities'].includes(kind)" class="grid gap-3 rounded-xl border border-stone-200 bg-white p-4 sm:grid-cols-2 xl:grid-cols-4">
      <label class="text-sm">Search student<input v-model="search" maxlength="100" type="search" placeholder="Name or Student ID" class="mt-2 min-h-11 w-full rounded-lg border border-stone-300 p-3" /></label>
      <label v-if="kind === 'students'" class="text-sm">Account status<select v-model="status" class="mt-2 min-h-11 w-full rounded-lg border border-stone-300 p-3"><option value="">All statuses</option><option>pending</option><option>approved</option><option>rejected</option></select></label>
      <label class="text-sm">Current attendance<select v-model="attendance" class="mt-2 min-h-11 w-full rounded-lg border border-stone-300 p-3"><option value="">All</option><option>IN</option><option>OUT</option></select></label>
      <label class="text-sm">{{ kind === 'students' ? 'Latest activity' : 'Activity type' }}<select v-model="category" class="mt-2 min-h-11 w-full rounded-lg border border-stone-300 p-3"><option value="">All activities</option><option v-for="item in categories" :key="item">{{ item }}</option></select></label>
      <label v-if="kind === 'activities'" class="text-sm">Submission date · Manila<input v-model="day" type="date" class="mt-2 min-h-11 w-full rounded-lg border border-stone-300 p-3" /></label>
    </div>
    <div class="flex flex-wrap items-center justify-between gap-2"><p class="text-xs text-stone-500">{{ recent ? (kind === 'students' ? '3-student directory snapshot' : 'Latest 3 records') : pageSize + ' records per page' }} · {{ kind === 'students' ? 'Filters search all student records' : kind === 'revisions' ? 'Oldest recorded revision first' : 'Server timestamps · Asia/Manila' }}</p><button type="button" :disabled="state.loading" class="inline-flex min-h-11 items-center gap-2 px-3 text-sm font-semibold text-brand disabled:opacity-50" @click="refresh"><RefreshCw :size="16" />Refresh</button></div>
    <p v-if="state.loading" role="status" class="p-4 text-sm text-stone-500">Loading records…</p>
    <p v-if="state.error" role="alert" class="rounded-lg border border-brand-gold/50 bg-brand-gold/10 p-4 text-sm">{{ state.error }}</p>
    <p v-if="!state.loading && !state.error && !state.rows.length" class="rounded-xl border bg-white p-6 text-sm text-stone-500">No matching records.</p>
    <ul v-if="kind === 'students'" class="space-y-3">
      <li v-for="row in state.rows" :key="row.id" class="rounded-xl border border-stone-200 bg-white p-5"><div class="flex flex-wrap justify-between gap-3"><div class="min-w-0"><h3 class="break-words font-semibold">{{ row.full_name }}</h3><p class="mt-1 text-sm text-stone-500">{{ row.student_id }} · {{ row.status }}</p><p class="mt-1 break-all text-sm text-stone-500">{{ row.email }}</p></div><span class="self-start rounded-full px-3 py-1 text-xs" :class="row.open_time_in ? 'bg-emerald-50 text-emerald-800' : 'bg-stone-100'">{{ row.open_time_in ? 'IN · ' + activityTime(row.open_time_in) : 'OUT' }}</span></div><p class="mt-3 text-sm">{{ hours(row.completed_seconds) }} / {{ row.required_hours }}h completed</p><progress class="mt-2 h-2 w-full accent-brand" :value="progress(row)" max="100" aria-label="Completed OJT progress"></progress><p class="mt-2 text-xs text-stone-500">Latest activity: {{ row.latest_category || 'None submitted' }}</p><RouterLink :to="'/admin/students/' + row.id" class="mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand">View Details<ArrowRight :size="16" /></RouterLink></li>
    </ul>
    <ul v-else-if="kind === 'attendance'" class="space-y-3"><li v-for="row in attendanceRows" :key="row.id" class="rounded-xl border border-stone-200 bg-white p-5"><div class="flex flex-wrap justify-between gap-2"><h3 class="font-semibold">{{ row.date }}</h3><span class="text-sm">{{ row.status }}</span></div><dl class="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3"><div><dt class="text-stone-500">Time In</dt><dd>{{ row.timeIn }}</dd></div><div><dt class="text-stone-500">Time Out</dt><dd>{{ row.timeOut }}</dd></div><div><dt class="text-stone-500">Completed hours</dt><dd>{{ row.hours }}</dd></div></dl></li></ul>
    <ExpandableList v-else :items="state.rows" :disabled="!collapseRecords" v-slot="{ visibleItems }"><ul class="space-y-4"><li v-for="row in visibleItems" :key="row.id" class="min-w-0 rounded-xl border border-stone-200 bg-white p-5">
      <AdminActivityCard v-if="monitorMode !== 'logs'" :activity="row"><template #context>
      <template v-if="kind === 'revisions'"><h3 class="font-semibold">{{ revisionLabel(row) }}</h3><p v-if="row.migration_baseline" class="mt-2 text-xs text-stone-500">Known state when auditing began. Earlier versions were not recorded.</p><p class="mt-2 text-xs text-stone-500">{{ activityDate(row.version_at) }} · {{ activityTime(row.version_at) }}</p></template>
      <template v-else><div v-if="!monitorMode" class="flex flex-wrap justify-between gap-2"><RouterLink :to="'/admin/students/' + row.student_uid" class="font-semibold text-brand">{{ row.full_name }}</RouterLink><span class="text-xs text-stone-500">{{ row.student_id }} · Currently {{ row.is_in ? 'IN' : 'OUT' }}</span></div><p class="mt-2 text-xs text-stone-500">Submitted {{ activityDate(row.created_at) }} · {{ activityTime(row.created_at) }}</p><p v-if="monitorMode !== 'current' && row.revision > 0" class="mt-2 text-xs font-semibold text-brand">Edited ×{{ row.revision }} · Last edited {{ activityDate(row.updated_at) }} · {{ activityTime(row.updated_at) }}</p></template>
      </template></AdminActivityCard>
      <template v-else>
        <p class="text-xs text-stone-500">Submitted {{ activityDate(row.created_at) }} · {{ activityTime(row.created_at) }}</p>
        <p v-if="row.revision > 0" class="mt-2 text-xs font-semibold text-brand">Edited ×{{ row.revision }} · Last edited {{ activityDate(row.updated_at) }} · {{ activityTime(row.updated_at) }}</p>
        <h4 class="mt-3 text-sm font-semibold text-brand">{{ row.category }}</h4><p v-if="row.revision === 0" class="mt-2 text-xs text-stone-500">No edits recorded.</p>
      </template>
      <template v-if="kind !== 'revisions' && monitorMode !== 'current'"><button type="button" :aria-expanded="opened === row.id" class="mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand" @click="opened = opened === row.id ? null : row.id"><History :size="16" />{{ monitorMode === 'logs' ? (opened === row.id ? 'Hide Changes' : 'View Changes') : (opened === row.id ? 'Hide Edit History' : 'View Edit History') }}</button><AdminActivityTimeline v-if="opened === row.id && monitorMode === 'logs'" :activity-id="row.id" /><AdminRecords v-else-if="opened === row.id" class="mt-4 border-l-2 border-brand-gold pl-3" kind="revisions" :activity-id="row.id" /></template>
    </li></ul></ExpandableList>
    <div v-if="!recent" class="flex flex-wrap items-center justify-between gap-3"><button type="button" :disabled="state.loading || state.page === 0" class="min-h-11 rounded-lg border px-4 text-sm text-brand disabled:opacity-40" @click="controller.previous()">Previous page</button><span class="text-xs text-stone-500">Page {{ state.page + 1 }}</span><button type="button" :disabled="state.loading || !state.next" class="min-h-11 rounded-lg border px-4 text-sm text-brand disabled:opacity-40" @click="controller.next()">Next page</button></div>
  </section>
</template>

