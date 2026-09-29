<script>
import { listPendingStudents, reviewStudent } from '../services/users'

export default {
  name: 'PendingRegistrations',
  data() {
    return { registrations: [], loading: false, busy: false, error: '', notice: '', selectedUid: null, decision: null }
  },
  mounted() { this.load() },
  methods: {
    async load() {
      this.loading = true
      this.error = ''
      try { this.registrations = await listPendingStudents() }
      catch { this.registrations = []; this.error = 'Unable to load pending registrations. Check your connection and administrator permissions.' }
      finally { this.loading = false }
    },
    registrationDate(value) {
      const date = value ? new Date(value) : null
      return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : 'Unavailable'
    },
    async confirmReview() {
      if (this.busy || !this.decision) return
      this.busy = true
      this.error = ''
      try {
        await reviewStudent(this.decision.uid, this.decision.status)
        this.notice = this.decision.status === 'approved' ? 'Student approved.' : 'Registration rejected. The sign-in account was not deleted.'
        this.decision = null
        await this.load()
      } catch {
        this.error = 'Unable to apply this decision. Refresh to check whether the registration is still pending and try again.'
      } finally { this.busy = false }
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
        <dl v-if="selectedUid === student.uid" class="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt class="text-stone-500">Program</dt><dd>{{ student.program }}</dd></div><div><dt class="text-stone-500">Year Level</dt><dd>{{ student.yearLevel || 'Not collected' }}</dd></div><div><dt class="text-stone-500">Registration Date</dt><dd>{{ registrationDate(student.createdAt) }}</dd></div><div><dt class="text-stone-500">Status</dt><dd>{{ student.status }}</dd></div></dl>
        <div class="mt-4 flex flex-wrap gap-2"><button type="button" :aria-expanded="selectedUid === student.uid" class="min-h-11 rounded-lg border border-stone-200 px-3 py-2 text-sm text-brand" @click="selectedUid = selectedUid === student.uid ? null : student.uid">{{ selectedUid === student.uid ? 'Hide Details' : 'View' }}</button><button type="button" :disabled="busy" class="min-h-11 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" @click="decision = { uid: student.uid, name: student.fullName, status: 'approved' }">Approve</button><button type="button" :disabled="busy" class="min-h-11 rounded-lg border border-stone-300 px-4 py-2 text-sm text-brand disabled:opacity-60" @click="decision = { uid: student.uid, name: student.fullName, status: 'rejected' }">Reject</button></div>
        <div v-if="decision?.uid === student.uid" class="mt-4 rounded-lg border border-brand-gold/50 bg-brand-gold/10 p-4">
          <p class="text-sm">{{ decision.status === 'approved' ? 'Approve' : 'Reject' }} {{ decision.name }}?</p>
          <div class="mt-3 flex flex-wrap gap-2"><button type="button" :disabled="busy" class="min-h-11 rounded-lg bg-brand px-4 py-2 text-sm text-white disabled:opacity-60" @click="confirmReview">{{ busy ? 'Applying...' : 'Confirm Decision' }}</button><button type="button" :disabled="busy" class="min-h-11 rounded-lg border border-stone-300 px-4 py-2 text-sm" @click="decision = null">Cancel</button></div>
        </div>
      </li>
    </ul>
  </section>
</template>

