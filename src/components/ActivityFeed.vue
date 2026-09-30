<script>
import { Clock3, Pencil, X, FileText } from 'lucide-vue-next'
import ExpandableList from './ExpandableList.vue'
import PrivateActivityProof from './PrivateActivityProof.vue'
import ActivityEditor from './ActivityEditor.vue'
import { activityApi, activityAccountKey, approvedActivityStudent } from '../services/supabaseActivities.js'
import { activityFeedState, createActivityFeed } from '../services/studentActivityController.js'
import { activityDate, activityTime, activityError, ACTIVITY_CATEGORIES } from '../services/supabaseActivityData.js'
export default {
  name: 'ActivityFeed', components: { Clock3, Pencil, X, FileText, ExpandableList, PrivateActivityProof, ActivityEditor },
  props: { recent: Boolean }, emits: ['loaded'],
  data() { return { feed: activityFeedState(), controller: null, selectedDate: '', selectedCategory: '',
    editing: null, editBusy: false, editLoading: false, error: '', notice: '', version: 0, categories: ACTIVITY_CATEGORIES } },
  computed: {
    accountKey() { return activityAccountKey() },
    dates() { return [...new Set(this.feed.records.map(row => activityDate(row.created_at)))] },
    filtered() { return this.feed.records.filter(row => (!this.selectedDate || activityDate(row.created_at) === this.selectedDate) && (!this.selectedCategory || row.category === this.selectedCategory)) },
  },
  watch: { accountKey() { this.start() }, 'feed.records'() { this.$emit('loaded', this.feed.records.length) } },
  mounted() { this.start(); window.addEventListener('focus', this.refresh) },
  beforeUnmount() { this.version++; this.controller?.stop(); window.removeEventListener('focus', this.refresh) },
  methods: {
    activityDate, activityTime,
    start() {
      this.version++; this.controller?.stop(); this.closeEdit(); this.feed = activityFeedState(); this.error = ''; this.notice = ''
      this.selectedDate = ''; this.selectedCategory = ''
      if (!approvedActivityStudent()) return
      this.controller = createActivityFeed(this.feed, activityApi, this.recent ? 3 : 25)
      this.controller.refresh()
    },
    refresh() { if (!this.editing && !this.editLoading) { this.selectedDate = ''; this.selectedCategory = ''; this.controller?.refresh() } },
    async page(direction) { this.selectedDate = ''; this.selectedCategory = ''; await this.controller?.[direction]() },
    async edit(row) {
      if (this.editLoading) return
      const version = ++this.version; this.editLoading = true; this.error = ''
      try {
        const current = await activityApi.details(row.id)
        if (version !== this.version) return
        if (!current) throw new Error('ACTIVITY_NOT_FOUND')
        this.editing = current
        await this.$nextTick(); this.$refs.dialog?.showModal()
      } catch (error) { if (version === this.version) this.error = activityError(error) }
      finally { if (version === this.version) this.editLoading = false }
    },
    closeEdit() { this.$refs.dialog?.close(); this.editing = null; this.editBusy = false; this.editLoading = false },
    async cancelEdit() { if (!this.editBusy && await this.$refs.editor?.cancel()) { this.closeEdit(); this.refresh() } },
    saved() { this.closeEdit(); this.notice = 'Activity updated.'; this.refresh() },
    reload(row) { this.editing = row },
  },
}
</script>
<template>
  <div>
    <div class="my-3 flex flex-wrap items-center justify-between gap-2"><p class="text-xs text-stone-500">{{ recent ? 'Your three most recent activity updates.' : '25 records per page · dates and times in Asia/Manila.' }}</p><button type="button" :disabled="feed.busy" class="min-h-11 px-2 text-sm font-semibold text-brand disabled:opacity-50" @click="refresh">Refresh activities</button></div>
    <div v-if="!recent" class="mb-5 grid gap-3 sm:grid-cols-2"><label class="text-sm text-stone-700">Date on this page<select v-model="selectedDate" class="mt-2 min-h-11 w-full rounded-lg border border-stone-300 bg-white p-3"><option value="">All Dates</option><option v-for="date in dates" :key="date">{{ date }}</option></select></label><label class="text-sm text-stone-700">Activity Type on this page<select v-model="selectedCategory" class="mt-2 min-h-11 w-full rounded-lg border border-stone-300 bg-white p-3"><option value="">All Activities</option><option v-for="category in categories" :key="category">{{ category }}</option></select></label></div>
    <p v-if="feed.busy" role="status" class="py-4 text-sm text-stone-500">Loading activities…</p>
    <p v-if="feed.error || error" role="alert" class="my-3 rounded-lg border border-brand-gold/50 bg-brand-gold/10 p-3 text-sm">{{ feed.error || error }}</p>
    <p v-if="notice" role="status" class="my-2 text-sm text-stone-600">{{ notice }}</p>
    <p v-if="!feed.busy && !feed.error && !filtered.length" role="status" class="py-5 text-sm text-stone-500">{{ feed.records.length ? 'No activities match the filters on this page.' : 'No activity updates on this page.' }}</p>
    <ExpandableList v-if="!feed.busy && filtered.length" :items="filtered" v-slot="{ visibleItems }">
      <ul :class="recent ? 'divide-y divide-stone-100' : 'space-y-4'">
        <li v-for="row in visibleItems" :key="row.id" :class="recent ? 'flex gap-3 py-4' : 'rounded-lg border border-stone-200 p-4 sm:p-5'">
          <span v-if="recent" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-stone-50 text-brand"><FileText :size="18" aria-hidden="true" /></span>
          <div class="min-w-0 flex-1"><div class="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500"><span>{{ activityDate(row.created_at) }}</span><span class="inline-flex items-center gap-1.5"><Clock3 :size="14" aria-hidden="true" />{{ activityTime(row.created_at) }}</span></div><h3 class="mt-3 text-sm font-semibold text-brand">{{ row.category }}</h3><p class="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-stone-600">{{ row.description }}</p><p v-if="row.updated_at" class="mt-2 text-xs text-stone-500">Edited {{ activityDate(row.updated_at) }} · {{ activityTime(row.updated_at) }}</p><div class="flex flex-wrap items-start justify-between gap-3"><PrivateActivityProof class="min-w-0 flex-1" :path="row.photo_path" /><button type="button" :disabled="editLoading" class="mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand disabled:opacity-50" @click="edit(row)"><Pencil :size="16" aria-hidden="true" />Edit</button></div></div>
        </li>
      </ul>
    </ExpandableList>
    <div v-if="!recent" class="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-4"><button type="button" :disabled="feed.busy || feed.page === 0" class="min-h-11 rounded-lg border px-4 text-sm font-semibold text-brand disabled:opacity-40" @click="page('previous')">Previous page</button><span class="text-xs text-stone-500">Page {{ feed.page + 1 }}</span><button type="button" :disabled="feed.busy || !feed.next" class="min-h-11 rounded-lg border px-4 text-sm font-semibold text-brand disabled:opacity-40" @click="page('next')">Next page</button></div>
    <Teleport to="body"><dialog v-if="editing" ref="dialog" aria-labelledby="edit-activity-heading" class="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-4xl overflow-y-auto rounded-xl bg-stone-50 p-4 sm:p-6 backdrop:bg-stone-950/50" @cancel.prevent="cancelEdit"><div class="mb-4 flex items-center justify-between gap-3"><h2 id="edit-activity-heading" class="text-xl font-semibold">Edit activity</h2><button type="button" aria-label="Close editor" :disabled="editBusy" class="min-h-11 min-w-11 p-2 disabled:opacity-50" @click="cancelEdit"><X :size="20" /></button></div><ActivityEditor ref="editor" :key="editing.id + ':' + editing.revision + ':' + accountKey" :record="editing" @saved="saved" @reload="reload" @busy="editBusy = $event" /></dialog></Teleport>
  </div>
</template>
