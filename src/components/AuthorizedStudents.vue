<script>
import { adminApi, adminKey } from '../services/supabaseAdmin.js'
import { adminPageState, createAdminPage } from '../services/adminPageController.js'

export default {
  name: 'AuthorizedStudents', emits: ['changed'],
  data() {
    return { state: adminPageState(), controller: null, search: '', appliedSearch: '', studentId: '', expectedName: '', busy: false, error: '', notice: '', version: 0, editingId: null, correctedName: '' }
  },
  computed: { identity() { return adminKey() } },
  watch: {
    identity() {
      this.version++; this.editingId = null; this.correctedName = ''; this.busy = false; this.error = ''; this.notice = ''; this.studentId = ''; this.expectedName = ''
      this.search = ''; this.appliedSearch = ''; this.refresh()
    },
  },
  mounted() {
    this.controller = createAdminPage(this.state, (cursor, size) => adminApi.roster({
      search_text: this.appliedSearch, page_size: size, after_student_id: cursor?.student_id || null,
    }), () => this.identity)
    this.refresh()
  },
  beforeUnmount() { this.version++; this.controller?.stop(); this.error = ''; this.notice = '' },
  methods: {
    refresh() { return this.controller?.refresh() },
    searchRoster() { this.appliedSearch = this.search.trim(); return this.refresh() },
    registrationLabel(value) { return ({ not_registered: 'Not Registered', pending: 'Pending', approved: 'Approved', rejected: 'Rejected' })[value] || 'Unavailable' },
    async mutate(operation, success, preservePage = false, closeEditor = false) {
      if (this.busy || !this.identity) return
      const version = ++this.version, identity = this.identity
      this.busy = true; this.error = ''; this.notice = ''
      try {
        await operation()
        if (version !== this.version || identity !== this.identity) return
        const reconciled = await (preservePage ? this.controller?.reload() : this.refresh())
        if (version !== this.version || identity !== this.identity) return
        this.$emit('changed')
        if (!reconciled) {
          this.error = 'The change was saved, but the updated roster could not be loaded. Your edit is kept; retry Refresh to confirm the server value.'
          return
        }
        if (closeEditor) { this.editingId = null; this.correctedName = '' }
        this.notice = success
      } catch (error) {
        if (version !== this.version || identity !== this.identity) return
        this.error = error?.message === 'STUDENT_ID_ALREADY_AUTHORIZED'
          ? 'This Student ID is already on the roster. Search or refresh to view its eligibility.'
          : error?.message === 'INVALID_ROSTER_DETAILS'
            ? 'Enter a valid Student ID and Student Name in Last Name, First Name Middle Name/Suffix format (up to 100 characters).'
            : 'Unable to confirm the change. Refresh to check its result before retrying.'
      } finally { if (version === this.version && identity === this.identity) this.busy = false }
    },
    addStudent() {
      return this.mutate(() => adminApi.addRoster(this.studentId, this.expectedName || null), 'Student ID added. Registration still requires administrator approval.')
    },
    editName(row) { if (this.busy) return; this.editingId = row.student_id; this.correctedName = row.expected_name || ''; this.error = ''; this.notice = '' },
    cancelEdit() { if (this.busy) return; this.editingId = null; this.correctedName = ''; this.error = '' },
    saveName() {
      const id = this.editingId, name = this.correctedName
      if (!id) return
      return this.mutate(() => adminApi.updateRosterName(id, name), 'Student Name saved. The list reflects the current search.', true, true)
    },
    setActive(row) {
      return this.mutate(() => adminApi.setRosterActive(row.student_id, !row.is_active), 'Eligibility updated. Pending approval requires eligibility; already-approved accounts keep access.', true)
    },
  },
}
</script>

<template>
  <section aria-labelledby="roster-heading" class="rounded-xl border border-stone-200 bg-white p-5 sm:p-6">
    <h2 id="roster-heading" class="text-lg font-semibold">Authorized Students</h2>
    <p class="mt-1 text-sm text-stone-500">Authorize Student IDs to request registration. Approval is still required. Eligibility is required for registration and pending approval. Approved accounts retain access.</p>
    <form class="mt-4 grid gap-3 sm:grid-cols-2" :aria-busy="busy" @submit.prevent="addStudent">
      <div><label for="roster-id" class="block text-sm font-medium">Student ID</label><input id="roster-id" v-model="studentId" required maxlength="30" :disabled="busy || !identity" class="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-stone-300 px-3 text-sm" /></div>
      <div><label for="roster-name" class="block text-sm font-medium">Student Name</label><input id="roster-name" v-model="expectedName" required maxlength="100" :disabled="busy || !identity" class="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-stone-300 px-3 text-sm" /></div>
      <p class="text-xs text-stone-500 sm:col-span-2">Last Name, First Name Middle Name/Suffix — e.g. Batiancila, Ralph Joseph R.</p>
      <button type="submit" :disabled="busy || !identity" class="min-h-11 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50 sm:justify-self-start">{{ busy ? 'Saving...' : 'Add Student' }}</button>
    </form>
    <p v-if="error" role="alert" class="mt-3 text-sm text-brand">{{ error }}</p>
    <p v-if="notice" role="status" class="mt-3 text-sm text-stone-600">{{ notice }}</p>
    <form class="mt-6 flex flex-wrap items-end gap-2" @submit.prevent="searchRoster">
      <div class="min-w-0 flex-1"><label for="roster-search" class="block text-sm font-medium">Search Student ID or name</label><input id="roster-search" v-model="search" maxlength="100" class="mt-1 min-h-11 w-full rounded-lg border border-stone-300 px-3 text-sm" /></div>
      <button class="min-h-11 rounded-lg border border-stone-300 px-4 text-sm font-semibold text-brand" type="submit" :disabled="busy || !identity">Search</button>
      <button class="min-h-11 px-3 text-sm text-brand" type="button" :disabled="busy || !identity" @click="refresh">Refresh</button>
    </form>
    <p v-if="state.loading" role="status" class="mt-4 text-sm text-stone-500">Loading authorized students...</p>
    <p v-if="state.error" role="alert" class="mt-4 text-sm text-brand">{{ state.error }}</p>
    <p v-if="!state.loading && !state.error && !state.rows.length" class="mt-4 text-sm text-stone-500">No authorized students found.</p>
    <ul class="mt-4 space-y-3">
      <li v-for="row in state.rows" :key="row.student_id" class="rounded-lg border border-stone-200 p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <p class="break-all text-sm font-semibold text-brand">{{ row.student_id }}</p>
            <p class="mt-1 break-words font-medium text-stone-900">{{ row.expected_name || 'Student Name needs correction' }}</p>
            <div class="mt-3 flex flex-wrap gap-2">
              <span class="rounded-full px-2.5 py-1 text-xs font-medium" :class="row.is_active ? 'bg-brand-gold/20 text-stone-800' : 'bg-stone-100 text-stone-600'">{{ row.is_active ? 'Active' : 'Inactive' }}</span>
              <span class="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-700">{{ registrationLabel(row.registration_state) }}</span>
            </div>
            <p v-if="row.registered_name" class="mt-2 break-words text-xs text-stone-500">Registered as: {{ row.registered_name }}</p>
            <p v-if="!row.verification_ready" class="mt-2 text-xs font-medium text-brand">Name correction required before registration or pending approval.</p>
          </div>
          <div class="flex shrink-0 flex-wrap gap-1">
            <button type="button" :disabled="busy || !identity" :aria-expanded="editingId === row.student_id" :aria-label="'Edit name for ' + row.student_id" class="min-h-11 rounded-lg px-3 text-sm font-semibold text-brand hover:bg-stone-50 disabled:opacity-50" @click="editName(row)">Edit</button>
            <button type="button" :disabled="busy || !identity" :aria-label="(row.is_active ? 'Deactivate ' : 'Activate ') + row.student_id" class="min-h-11 rounded-lg px-3 text-sm text-stone-600 hover:bg-stone-50 disabled:opacity-50" @click="setActive(row)">{{ row.is_active ? 'Deactivate' : 'Activate' }}</button>
          </div>
        </div>
        <form v-if="editingId === row.student_id" class="mt-4 space-y-2 border-t border-stone-100 pt-4" :aria-busy="busy" @submit.prevent="saveName">
          <label :for="'correct-' + row.student_id" class="block text-sm font-medium">Student Name</label>
          <input :id="'correct-' + row.student_id" v-model="correctedName" required maxlength="100" :disabled="busy" class="min-h-11 w-full min-w-0 rounded-lg border border-stone-300 px-3 text-sm" />
          <p class="text-xs text-stone-500">Last Name, First Name Middle Name/Suffix</p>
          <div class="flex justify-end gap-2">
            <button :disabled="busy" type="button" class="min-h-11 rounded-lg px-4 text-sm text-stone-600 disabled:opacity-50" @click="cancelEdit">Cancel</button>
            <button :disabled="busy || !identity" type="submit" class="min-h-11 rounded-lg bg-brand px-4 text-sm font-semibold text-white disabled:opacity-50">{{ busy ? 'Saving...' : 'Save' }}</button>
          </div>
        </form>
      </li>
    </ul>
    <div class="mt-4 flex items-center justify-between gap-2"><button type="button" :disabled="busy || state.loading || !state.page" class="min-h-11 px-3 text-sm text-brand disabled:opacity-40" @click="controller.previous()">Previous</button><span class="text-xs text-stone-500">Page {{ state.page + 1 }}</span><button type="button" :disabled="busy || state.loading || !state.next" class="min-h-11 px-3 text-sm text-brand disabled:opacity-40" @click="controller.next()">Next</button></div>
  </section>
</template>
