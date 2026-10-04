<script>
import { Send } from 'lucide-vue-next'
import ActivityPhotoInput from './ActivityPhotoInput.vue'
import PrivateActivityProof from './PrivateActivityProof.vue'
import { activityApi, activityAccountKey, approvedActivityStudent } from '../services/supabaseActivities.js'
import { getAttendanceSummary } from '../services/supabaseAttendance.js'
import { activityEditorState, createActivityController } from '../services/studentActivityController.js'
import { ACTIVITY_CATEGORIES, characterCount, activityDate, activityTime } from '../services/supabaseActivityData.js'
export default {
  name: 'ActivityEditor', components: { ActivityPhotoInput, PrivateActivityProof, Send },
  props: { record: { type: Object, default: null }, openAttendance: { type: Boolean, default: false }, attendanceLoading: Boolean },
  emits: ['saved', 'reload', 'busy'],
  data() { return { form: { category: this.record?.category || '', description: this.record?.description || '', file: null },
    editor: activityEditorState(), controller: null, photoChecking: false, categories: ACTIVITY_CATEGORIES } },
  computed: {
    accountKey() { return activityAccountKey() },
    eligible() { return approvedActivityStudent() },
    count() { return characterCount(this.form.description.trim()) },
    locked() { return this.editor.busy || !!this.editor.attempt },
    disabled() { return !this.eligible || this.editor.busy || this.photoChecking || (!this.record && !this.openAttendance && !this.editor.attempt) },
    prefix() { return this.record ? 'edit-activity' : 'new-activity' },
  },
  watch: { accountKey() { this.resetAccount() }, 'editor.busy'(value) { this.$emit('busy', value) } },
  mounted() { this.resetAccount() },
  beforeUnmount() { this.controller?.stop() },
  methods: {
    activityDate, activityTime,
    resetAccount() {
      this.controller?.stop(); this.editor = activityEditorState(); this.photoChecking = false
      this.form = { category: this.record?.category || '', description: this.record?.description || '', file: null }
      const accountKey = this.accountKey
      this.controller = createActivityController(this.editor, { api: activityApi, summary: getAttendanceSummary,
        allowed: () => this.eligible && this.accountKey === accountKey })
    },
    confirmed() {
      if (!this.editor.saved) return
      const row = this.editor.saved
      this.form = { category: '', description: '', file: null }
      this.$emit('saved', row)
    },
    async submit() { if (this.disabled) return; await this.controller.save(this.form, this.record); this.confirmed() },
    async check() { await this.controller.check(); this.confirmed() },
    async cancel() { return this.controller.clear() },
    async clear() {
      const conflict = this.editor.conflict
      if (await this.controller.clear()) {
        if (this.editor.saved) { this.confirmed(); return }
        if (conflict) this.$emit('reload', conflict)
      }
    },
  },
}
</script>
<template>
  <form class="grid items-start gap-6 xl:grid-cols-2" @submit.prevent="submit">
    <section class="min-w-0 rounded-xl border border-stone-200 bg-white p-5 sm:p-6" :aria-labelledby="prefix + '-photo'">
      <h2 :id="prefix + '-photo'" class="text-lg font-semibold text-stone-900">{{ record ? 'Proof photo' : 'Photo Proof' }}</h2>
      <template v-if="record"><p class="mt-2 text-xs text-stone-500">Keep the current proof, or choose a replacement below.</p><PrivateActivityProof :path="record.photo_path" /></template>
      <ActivityPhotoInput :key="accountKey" v-model:file="form.file" :disabled="locked || !eligible" @validating="photoChecking = $event" />
    </section>
    <section class="min-w-0 rounded-xl border border-stone-200 bg-white p-5 sm:p-6" :aria-labelledby="prefix + '-details'">
      <h2 :id="prefix + '-details'" class="text-lg font-semibold text-stone-900">Activity Details</h2>
      <p v-if="record" class="mt-2 text-xs text-stone-500">Created {{ activityDate(record.created_at) }} at {{ activityTime(record.created_at) }} · Asia/Manila</p>
      <fieldset :disabled="locked || !eligible" class="mt-5 space-y-5 disabled:opacity-70">
        <div><label :for="prefix + '-category'" class="mb-2 block text-sm font-medium text-stone-700">Activity Type</label><select :id="prefix + '-category'" v-model="form.category" required class="min-h-12 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-3 text-sm"><option disabled value="">Select an activity type</option><option v-for="category in categories" :key="category" :value="category">{{ category }}</option></select></div>
        <div><label :for="prefix + '-description'" class="mb-2 block text-sm font-medium text-stone-700">Activity Description</label><textarea :id="prefix + '-description'" v-model="form.description" required rows="6" :aria-describedby="prefix + '-help ' + prefix + '-privacy ' + prefix + '-count'" placeholder="Example: Installed Windows 10 on an office computer and checked the hardware components." class="w-full resize-y rounded-lg border border-stone-300 px-3 py-3 text-sm leading-6"></textarea><p :id="prefix + '-help'" class="mt-2 text-xs leading-5 text-stone-600">Describe what you actually worked on. This description will appear exactly as recorded in your OJT Journal.</p><p :id="prefix + '-privacy'" class="mt-1 text-xs leading-5 text-stone-500">Do not include passwords, credentials, personal information, or confidential company information.</p><p :id="prefix + '-count'" class="mt-1 text-right text-xs" :class="count > 500 ? 'text-brand' : 'text-stone-500'">{{ count }} / 500 characters</p></div>
      </fieldset>
      <p v-if="!record && !openAttendance" role="status" class="mt-4 rounded-lg bg-stone-50 p-3 text-sm text-stone-600">{{ attendanceLoading ? 'Checking attendance…' : 'Time In before submitting an activity update.' }}</p>
      <p v-if="record" class="mt-4 text-xs text-stone-500">You can edit this activity after Time Out. Its original session and creation time stay unchanged.</p>
      <button type="submit" :disabled="disabled || editor.unresolved || !!editor.conflict" :aria-busy="editor.busy" class="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"><Send :size="18" aria-hidden="true" />{{ editor.busy ? editor.phase : editor.attempt ? 'Retry same submission' : record ? 'Save Changes' : 'Send Activity Update' }}</button>
      <div v-if="editor.attempt && !editor.busy" class="mt-3 flex flex-wrap gap-3"><button type="button" class="min-h-11 rounded-lg border px-3 text-sm font-semibold text-brand" @click="check">Check server result</button><button type="button" class="min-h-11 rounded-lg border px-3 text-sm font-semibold text-brand" @click="clear">{{ editor.conflict ? 'Use current server version' : 'Clear draft safely' }}</button></div>
    </section>
    <p v-if="editor.error" role="alert" class="rounded-lg border border-brand-gold/50 bg-brand-gold/10 p-4 text-sm xl:col-span-2">{{ editor.error }}</p>
    <div v-if="editor.conflict" class="rounded-lg border border-stone-200 bg-white p-4 text-sm xl:col-span-2"><p class="font-semibold">Current server version</p><p class="mt-2 text-brand">{{ editor.conflict.category }}</p><p class="mt-2 whitespace-pre-wrap break-words text-stone-600">{{ editor.conflict.description }}</p></div>
    <p v-if="editor.notice" role="status" class="text-sm text-stone-700 xl:col-span-2">{{ editor.notice }}</p>
  </form>
</template>
