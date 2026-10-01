<script>
import { adminAttendanceSignals } from '../services/adminAttendanceSignals.js'

import { RefreshCw } from 'lucide-vue-next'
import ActivityDisclosure from './ActivityDisclosure.vue'
import AdminActivityCard from './AdminActivityCard.vue'
import { adminApi, adminKey } from '../services/supabaseAdmin.js'
import { adminPageState, createAdminPage } from '../services/adminPageController.js'
import { activityDate, activityTime } from '../services/supabaseActivityData.js'
export default {
  name: 'AdminRecentActivities',
  components: { ActivityDisclosure, AdminActivityCard, RefreshCw },
  data() { return { state: adminPageState(), controller: null, removeAttendanceSignal: null, opened: null } },
  computed: {
    identity() { return adminKey() },
    groups() {
      const groups = new Map()
      for (const row of this.state.rows) {
        if (!groups.has(row.student_uid)) groups.set(row.student_uid, { uid: row.student_uid, latest: row, activities: [] })
        groups.get(row.student_uid).activities.push(row)
      }
      return [...groups.values()]
    },
  },
  watch: { identity() { this.start() } },
  mounted() { this.removeAttendanceSignal = adminAttendanceSignals.register(() => this.controller?.reload()); this.start(); window.addEventListener('focus', this.refresh) },
  beforeUnmount() { this.removeAttendanceSignal?.(); this.controller?.stop(); window.removeEventListener('focus', this.refresh) },
  methods: {
    activityDate, activityTime,
    start() {
      this.controller?.stop(); this.opened = null; this.state = adminPageState()
      this.controller = createAdminPage(this.state, this.load, () => this.identity, 3)
      return this.controller.refresh()
    },
    load() { return adminApi.activities({ page_size: 3 }) },
    refresh() { this.opened = null; return this.controller?.refresh() },
    toggle(uid, expanded) { this.opened = expanded ? uid : null },
    excerpt(text) { return text.length > 120 ? text.slice(0, 120).trimEnd() + '…' : text },
  },
}
</script>
<template>
  <div class="mt-3 min-w-0 space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2"><p class="text-xs text-stone-500">Latest 3 updates · Asia/Manila</p><button type="button" :disabled="state.loading" class="inline-flex min-h-11 items-center gap-2 px-3 text-sm font-semibold text-brand disabled:opacity-50" @click="refresh"><RefreshCw :size="16" aria-hidden="true" />Refresh</button></div>
    <p v-if="state.loading" role="status" class="text-sm text-stone-500">Loading recent activities…</p>
    <p v-if="state.error" role="alert" class="text-sm text-brand">{{ state.error }}</p>
    <p v-if="!state.loading && !state.error && !state.rows.length" class="text-sm text-stone-500">No recent activities.</p>
    <ActivityDisclosure v-for="group in groups" :id="'dashboard-activities-' + group.uid" :key="group.uid + ':' + identity" :data-student-uid="group.uid" :expanded="opened === group.uid" @update:expanded="toggle(group.uid, $event)">
      <template #summary>
        <div class="flex flex-wrap justify-between gap-2"><div class="min-w-0"><h3 class="break-words font-semibold">{{ group.latest.full_name }}</h3><p class="mt-1 break-words text-xs text-stone-500">{{ group.latest.student_id }}</p></div><span class="self-start rounded-full px-3 py-1 text-xs" :class="group.latest.is_in ? 'bg-emerald-50 text-emerald-800' : 'bg-stone-100 text-stone-600'">{{ group.latest.is_in ? 'IN' : 'OUT' }}</span></div>
        <p class="mt-3 text-sm font-semibold text-brand">{{ group.latest.category }}</p>
        <p class="mt-1 break-words text-sm leading-6 text-stone-600">{{ excerpt(group.latest.description) }}</p>
        <p class="mt-2 text-xs text-stone-500">{{ activityDate(group.latest.created_at) }} · {{ activityTime(group.latest.created_at) }}</p>
        <p v-if="group.activities.length > 1" class="mt-1 text-xs text-stone-500">{{ group.activities.length }} of the latest {{ state.rows.length }} updates</p>
      </template>
      <ul class="space-y-4"><li v-for="activity in group.activities" :key="activity.id" class="min-w-0"><AdminActivityCard :activity="activity" /></li></ul>
    </ActivityDisclosure>
  </div>
</template>
