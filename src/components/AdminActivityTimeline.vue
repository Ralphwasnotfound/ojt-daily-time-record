<script>
import AdminActivityProof from './AdminActivityProof.vue'
import { adminApi, adminKey } from '../services/supabaseAdmin.js'
import { adminPageState, createAdminPage } from '../services/adminPageController.js'
import { activityDate, activityTime } from '../services/supabaseActivityData.js'
export default {
  name: 'AdminActivityTimeline', components: { AdminActivityProof },
  props: { activityId: { type: String, required: true } },
  data() { return { state: adminPageState(), controller: null } },
  computed: { identity() { return adminKey() } },
  watch: { identity() { this.start() }, activityId() { this.start() } },
  mounted() { this.start() },
  beforeUnmount() { this.controller?.stop() },
  methods: {
    activityDate, activityTime,
    title(row) { return row.migration_baseline ? 'First available version' : row.revision === 0 ? 'Original' : 'Edit #' + row.revision },
    start() { this.controller?.stop(); this.state = adminPageState(); this.controller = createAdminPage(this.state, this.load, () => this.identity); return this.controller.refresh() },
    load(cursor, size) { return adminApi.revisions({ target_activity: this.activityId, page_size: size, after_revision: cursor?.revision ?? -1 }) },
  },
}
</script>
<template>
  <section aria-label="Activity changes" class="mt-4 border-l-2 border-brand-gold pl-4 sm:pl-5">
    <div class="flex flex-wrap items-center justify-between gap-2"><h4 class="text-sm font-semibold">Changes · oldest to newest</h4><button type="button" :disabled="state.loading" class="min-h-11 px-2 text-sm font-semibold text-brand disabled:opacity-50" @click="controller.refresh()">Refresh changes</button></div>
    <p v-if="state.loading" role="status" class="py-3 text-sm text-stone-500">Loading changes…</p>
    <p v-if="state.error" role="alert" class="py-3 text-sm text-brand">{{ state.error }}</p>
    <p v-if="!state.loading && !state.error && !state.rows.length" class="py-3 text-sm text-stone-500">No recorded versions on this page.</p>
    <ol class="divide-y divide-stone-200">
      <li v-for="row in state.rows" :key="row.id" class="min-w-0 py-5">
        <div class="flex flex-wrap items-center gap-2"><h5 class="text-sm font-semibold text-stone-900">{{ title(row) }}</h5><span v-if="row.revision === row.current_revision" class="rounded-full bg-brand-gold/20 px-2.5 py-1 text-xs font-semibold text-brand">Current</span></div>
        <p v-if="row.migration_baseline" class="mt-2 text-xs text-stone-500">Edit history is available from this point.</p>
        <p class="mt-2 text-xs text-stone-500">{{ activityDate(row.version_at) }} · {{ activityTime(row.version_at) }}</p>
        <p class="mt-3 text-sm font-semibold text-brand">{{ row.category }}</p><p class="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-stone-600">{{ row.description }}</p>
        <AdminActivityProof :path="row.photo_path" />
      </li>
    </ol>
    <div v-if="state.page > 0 || state.next" class="mt-4 flex flex-wrap items-center justify-between gap-3"><button type="button" :disabled="state.loading || state.page === 0" class="min-h-11 rounded-lg border px-3 text-sm text-brand disabled:opacity-40" @click="controller.previous()">Previous changes</button><span class="text-xs text-stone-500">Page {{ state.page + 1 }}</span><button type="button" :disabled="state.loading || !state.next" class="min-h-11 rounded-lg border px-3 text-sm text-brand disabled:opacity-40" @click="controller.next()">Next changes</button></div>
  </section>
</template>
