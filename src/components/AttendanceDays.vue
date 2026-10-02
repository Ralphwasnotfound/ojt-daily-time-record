<script>
import { formatAttendanceRows, formatManilaDate, duration } from '../services/supabaseAttendancePresentation.js'
export default {
  name: 'AttendanceDays',
  props: { load: { type: Function, required: true }, identity: { type: String, required: true }, refreshKey: { default: null } },
  data() { return { days: [], day: '', page: 0, cursors: [null], next: null, loading: false, error: '', generation: 0 } },
  watch: { identity() { this.reset() }, day() { this.reset() }, refreshKey() { this.refresh() } },
  mounted() { this.reset(); window.addEventListener('focus', this.refresh) },
  beforeUnmount() { this.generation++; window.removeEventListener('focus', this.refresh) },
  methods: {
    formatAttendanceRows, duration,
    date(day) { return formatManilaDate(day + 'T00:00:00+08:00') },
    reset() { this.cursors = [null]; return this.read(0) },
    refresh() { return this.read(this.page) },
    async read(page) {
      const version = ++this.generation, identity = this.identity
      this.days = []; this.error = ''; this.loading = !!identity; this.page = page; this.next = null
      if (!identity) return
      try {
        const result = await this.load({ day_limit: 15, before_day: this.cursors[page], on_day: this.day || null })
        if (version !== this.generation || identity !== this.identity) return
        this.days = result.days; this.next = result.next_before_day
        this.cursors.length = page + 1; this.cursors[page + 1] = this.next
      } catch { if (version === this.generation) this.error = 'Unable to load attendance. Please refresh.' }
      finally { if (version === this.generation) this.loading = false }
    },
  },
}
</script>
<template>
  <section class="min-w-0 space-y-4" aria-label="Attendance days">
    <div class="flex flex-wrap items-end justify-between gap-3"><label class="text-sm">Start date · Manila<input v-model="day" type="date" class="mt-2 block min-h-11 rounded-lg border border-stone-300 p-2" /></label><button type="button" class="min-h-11 px-3 text-sm font-semibold text-brand" :disabled="loading" @click="refresh">Refresh attendance</button></div>
    <p class="text-xs text-stone-500">15 start-days per page · Newest first · Breaks and open sessions excluded from completed hours.</p>
    <p v-if="loading" role="status">Loading attendance history…</p><p v-if="error" role="alert" class="text-sm text-brand">{{ error }}</p>
    <p v-if="!loading && !error && !days.length" class="text-sm text-stone-500">No attendance recorded for this selection.</p>
    <article v-for="group in days" :key="group.start_day" class="rounded-xl border border-stone-200 bg-white p-4">
      <h3 class="font-semibold">{{ date(group.start_day) }}</h3>
      <div v-for="(row, index) in formatAttendanceRows(group.sessions)" :key="row.id" class="mt-3 border-t border-stone-100 pt-3 text-sm">
        <p class="font-semibold text-brand">Session {{ group.sessions[index].session_ordinal }}</p>
        <dl class="mt-2 grid gap-3 sm:grid-cols-3">
          <div><dt class="text-xs text-stone-500">Time In</dt><dd>{{ row.timeIn }}<slot name="proof" :session="group.sessions[index]" action="time_in" /></dd></div>
          <div><dt class="text-xs text-stone-500">Time Out</dt><dd>{{ row.timeOut }}<slot v-if="group.sessions[index].time_out" name="proof" :session="group.sessions[index]" action="time_out" /></dd></div>
          <div><dt class="text-xs text-stone-500">{{ row.status }}</dt><dd>{{ row.hours }}</dd></div>
        </dl>
      </div>
      <p class="mt-4 text-sm font-semibold">Daily completed total · {{ duration(group.completed_seconds) }}</p>
    </article>
    <div class="flex flex-wrap items-center justify-between gap-3"><button type="button" :disabled="loading || page === 0" class="min-h-11 rounded-lg border px-4 text-sm text-brand disabled:opacity-40" @click="read(page - 1)">Previous</button><span class="text-xs text-stone-500">Page {{ page + 1 }}</span><button type="button" :disabled="loading || !next" class="min-h-11 rounded-lg border px-4 text-sm text-brand disabled:opacity-40" @click="read(page + 1)">Next</button></div>
  </section>
</template>
