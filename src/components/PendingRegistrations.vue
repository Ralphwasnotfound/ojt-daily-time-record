<script>
import { reviewStudent, profileFromRow } from '../services/users'
import { adminApi, adminKey } from '../services/supabaseAdmin.js'
export default {
  name: 'PendingRegistrations', emits: ['reviewed'],
  data() { return { registrations: [], loading: false, busy: false, error: '', notice: '', selectedUid: null, decision: null, version: 0, page: 0, cursors: [null], hasNext: false } },
  computed: { identity() { return adminKey() } },
  watch: { identity() { this.version++; this.decision = null; this.notice = ''; this.busy = false; this.load() } },
  mounted() { this.load() }, beforeUnmount() { this.version++; this.registrations = []; this.decision = null },
  methods: {
    async load(page = 0) {
      if (typeof page !== 'number') page = 0
      const version = ++this.version, identity = this.identity
      this.registrations = []; this.loading = !!identity; this.error = ''; this.decision = null; this.selectedUid = null
      if (page === 0) this.cursors = [null]
      if (!identity) return
      try {
        const rows = await adminApi.students({ account_status: 'pending', page_size: 25, after_id: this.cursors[page] })
        if (version !== this.version || identity !== this.identity) return
        this.registrations = rows.map(profileFromRow); this.page = page; this.hasNext = rows.length === 25
        this.cursors[page + 1] = rows.at(-1)?.id || null
      } catch { if (version === this.version) this.error = 'Unable to load pending registrations. Check your connection and administrator permissions.' }
      finally { if (version === this.version) this.loading = false }
    },
    registrationDate(value) { return value ? new Date(value).toLocaleString('en-US', { timeZone: 'Asia/Manila' }) : 'Unavailable' },
    async confirmReview() {
      if (this.busy || !this.decision || !this.identity) return
      if (this.decision.status === 'approved' && !this.registrations.find(row => row.uid === this.decision.uid)?.rosterEligible) {
        this.error = 'This registration is not currently eligible. Correct its roster authorization and refresh before approval.'; return
      }
      const decision = { ...this.decision }, identity = this.identity, version = this.version
      this.busy = true; this.error = ''
      try {
        await reviewStudent(decision.uid, decision.status)
        if (identity !== this.identity || version !== this.version) return
        this.notice = decision.status === 'approved' ? 'Student approved.' : 'Registration rejected. The sign-in account was not deleted.'
        this.decision = null; this.$emit('reviewed'); await this.load()
      } catch { if (identity === this.identity && version === this.version) this.error = 'Unable to apply this decision. Refresh to check whether the registration is still pending and try again.' }
      finally { if (identity === this.identity) this.busy = false }
    },
  },
}
</script>
<template>
  <section aria-labelledby="pending-heading" class="rounded-xl border border-stone-200 bg-white p-5 sm:p-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div><h2 id="pending-heading" class="text-lg font-semibold">Pending Registrations</h2><p class="mt-1 text-xs text-stone-500">Student registrations awaiting review.</p></div>
      <button type="button" :disabled="loading || busy" class="min-h-11 rounded-lg border border-stone-200 px-4 py-2 text-sm font-semibold text-brand disabled:opacity-60" @click="load">Refresh</button>
    </div>
    <p v-if="loading" role="status" class="mt-4 text-sm text-stone-500">Loading registrations...</p>
    <p v-if="error" role="alert" class="mt-4 text-sm text-brand">{{ error }}</p>
    <p v-if="notice" role="status" class="mt-4 text-sm text-stone-600">{{ notice }}</p>
    <p v-if="!loading && !error && !registrations.length" class="mt-4 text-sm text-stone-500">No pending registrations.</p>
    <ul v-if="!loading" class="mt-4 space-y-4">
      <li v-for="student in registrations" :key="student.uid" class="rounded-lg border border-stone-200 p-4">
        <div class="flex flex-wrap justify-between gap-3"><div class="min-w-0"><h3 class="break-words text-sm font-semibold">{{ student.fullName }}</h3><p class="mt-1 text-xs text-stone-500">{{ student.studentId }}</p><p class="mt-1 break-all text-sm text-stone-600">{{ student.email }}</p></div><span class="self-start rounded-full bg-brand-gold/20 px-3 py-1 text-xs font-medium">Pending</span></div>
        <p class="mt-3 text-xs font-semibold" :class="student.rosterEligible ? 'text-green-700' : 'text-red-700'">{{ student.rosterEligible ? 'AUTHORIZED / ROSTER VERIFIED' : 'NOT CURRENTLY ELIGIBLE' }}</p>
        <dl v-if="selectedUid === student.uid" class="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt class="text-stone-500">Program</dt><dd>{{ student.program }}</dd></div><div><dt class="text-stone-500">Year Level</dt><dd>{{ student.yearLevel || 'Not collected' }}</dd></div><div><dt class="text-stone-500">Registration Date</dt><dd>{{ registrationDate(student.createdAt) }}</dd></div><div><dt class="text-stone-500">Status</dt><dd>{{ student.status }}</dd></div></dl>
        <div class="mt-4 flex flex-wrap gap-2"><button type="button" :aria-expanded="selectedUid === student.uid" class="min-h-11 rounded-lg border border-stone-200 px-3 py-2 text-sm text-brand" @click="selectedUid = selectedUid === student.uid ? null : student.uid">{{ selectedUid === student.uid ? 'Hide Details' : 'View' }}</button><button type="button" :disabled="busy || !student.rosterEligible" class="min-h-11 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" @click="decision = { uid: student.uid, name: student.fullName, status: 'approved' }">Approve</button><button type="button" :disabled="busy" class="min-h-11 rounded-lg border border-stone-300 px-4 py-2 text-sm text-brand disabled:opacity-60" @click="decision = { uid: student.uid, name: student.fullName, status: 'rejected' }">Reject</button></div>
        <div v-if="decision?.uid === student.uid" class="mt-4 rounded-lg border border-brand-gold/50 bg-brand-gold/10 p-4">
          <p class="text-sm">{{ decision.status === 'approved' ? 'Approve' : 'Reject' }} {{ decision.name }}?</p>
          <div class="mt-3 flex flex-wrap gap-2"><button type="button" :disabled="busy || (decision.status === 'approved' && !student.rosterEligible)" class="min-h-11 rounded-lg bg-brand px-4 py-2 text-sm text-white disabled:opacity-60" @click="confirmReview">{{ busy ? 'Applying...' : 'Confirm Decision' }}</button><button type="button" :disabled="busy" class="min-h-11 rounded-lg border border-stone-300 px-4 py-2 text-sm" @click="decision = null">Cancel</button></div>
        </div>
      </li>
    </ul>
    <div class="mt-4 flex justify-between gap-3"><button type="button" :disabled="loading || busy || page === 0" class="min-h-11 px-3 text-sm text-brand disabled:opacity-40" @click="load(page - 1)">Previous page</button><span class="self-center text-xs text-stone-500">Page {{ page + 1 }}</span><button type="button" :disabled="loading || busy || !hasNext" class="min-h-11 px-3 text-sm text-brand disabled:opacity-40" @click="load(page + 1)">Next page</button></div>
  </section>
</template>

