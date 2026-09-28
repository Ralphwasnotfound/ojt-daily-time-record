<script>
import { CalendarDays, Camera, Image, Clock3 } from 'lucide-vue-next'

export default {
  name: 'AttendanceView',
  components: { CalendarDays, Camera, Image, Clock3 },
  data() {
    return {
      currentDate: new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
      actionNotice: '',
      // Static examples only. No elapsed hours or attendance records are calculated.
      todayAttendance: {
        status: 'IN', timeIn: '8:02 AM', timeOut: '--', renderedHours: '5h 14m',
        proofs: [
          { label: 'Time In Proof', captured: '8:02 AM', date: 'September 28, 2026' },
          { label: 'Time Out Proof', captured: null, date: null },
        ],
      },
      attendanceSummary: [
        { label: 'Days Present', value: '18' },
        { label: 'Completed Hours', value: '126h 15m' },
        { label: 'Required Hours', value: '486h' },
      ],
      attendanceHistory: [
        { id: 1, date: 'September 25, 2026', day: 'Friday', timeIn: '8:01 AM', timeOut: '5:03 PM', hours: '9h 02m', status: 'Complete' },
        { id: 2, date: 'September 24, 2026', day: 'Thursday', timeIn: '8:05 AM', timeOut: '5:00 PM', hours: '8h 55m', status: 'Complete' },
        { id: 3, date: 'September 23, 2026', day: 'Wednesday', timeIn: '8:00 AM', timeOut: '--', hours: '--', status: 'Incomplete' },
        { id: 4, date: 'September 22, 2026', day: 'Tuesday', timeIn: '7:58 AM', timeOut: '5:02 PM', hours: '9h 04m', status: 'Complete' },
        { id: 5, date: 'September 21, 2026', day: 'Monday', timeIn: '8:03 AM', timeOut: '5:01 PM', hours: '8h 58m', status: 'Complete' },
        { id: 6, date: 'September 18, 2026', day: 'Friday', timeIn: '8:02 AM', timeOut: '5:00 PM', hours: '8h 58m', status: 'Complete' },
        { id: 7, date: 'September 17, 2026', day: 'Thursday', timeIn: '8:00 AM', timeOut: '5:00 PM', hours: '9h 00m', status: 'Complete' },
      ],
    }
  },
  methods: {
    previewAction() {
      this.actionNotice = 'Attendance is not connected yet. No photo was captured and no attendance record was changed.'
    },
    badgeClass(status) {
      return status === 'Complete' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'
    },
  },
}
</script>

<template>
  <div class="space-y-6">
    <header>
      <h1 class="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">Attendance</h1>
      <p class="mt-2 text-sm leading-6 text-stone-600">Track your daily OJT attendance and rendered hours.</p>
      <p class="mt-3 flex items-center gap-2 text-sm text-stone-500"><CalendarDays :size="16" class="shrink-0" aria-hidden="true" />{{ currentDate }}</p>
    </header>
    <p class="border-l-2 border-brand-gold pl-3 text-xs leading-5 text-stone-500">Static preview data dated September 28, 2026. Attendance and hours are not live.</p>

    <section aria-labelledby="today-heading" class="rounded-xl border border-stone-200 bg-white p-5 sm:p-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 id="today-heading" class="text-lg font-semibold text-stone-900">Today's Attendance</h2>
        <span class="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold" :class="todayAttendance.status === 'IN' ? 'bg-emerald-50 text-emerald-800' : 'bg-stone-100 text-stone-600'"><span class="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true"></span>CURRENTLY {{ todayAttendance.status }}</span>
      </div>
      <div class="mt-5 grid gap-6 xl:grid-cols-2">
        <div>
          <dl class="grid gap-4 sm:grid-cols-3">
            <div class="rounded-lg bg-stone-50 p-4"><dt class="text-xs text-stone-500">Time In</dt><dd class="mt-2 text-lg font-semibold text-stone-900">{{ todayAttendance.timeIn }}</dd></div>
            <div class="rounded-lg bg-stone-50 p-4"><dt class="text-xs text-stone-500">Time Out</dt><dd class="mt-2 text-lg font-semibold text-stone-900">{{ todayAttendance.timeOut }}</dd></div>
            <div class="rounded-lg bg-stone-50 p-4"><dt class="text-xs text-stone-500">Rendered Hours</dt><dd class="mt-2 text-lg font-semibold text-stone-900">{{ todayAttendance.renderedHours }}</dd></div>
          </dl>
          <button type="button" aria-describedby="photo-note" class="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-dark" @click="previewAction"><Camera :size="18" aria-hidden="true" />{{ todayAttendance.status === 'IN' ? 'Time Out' : 'Time In' }}</button>
          <p id="photo-note" class="mt-3 text-xs leading-5 text-stone-500">UI preview only. Photo verification will be required when attendance is connected.</p>
          <p role="status" aria-live="polite" :class="actionNotice ? 'mt-3 rounded-lg border border-brand-gold/50 bg-brand-gold/10 p-3 text-sm leading-6 text-stone-700' : 'sr-only'">{{ actionNotice }}</p>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <section v-for="proof in todayAttendance.proofs" :key="proof.label" :aria-label="proof.label" class="rounded-lg border border-stone-200 p-3">
            <h3 class="text-sm font-medium text-stone-700">{{ proof.label }}</h3>
            <div class="mt-3 flex h-24 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-stone-300 bg-stone-50 text-stone-400"><Image :size="24" aria-hidden="true" /><span class="text-xs">{{ proof.captured ? 'Photo placeholder' : 'No Time Out proof yet' }}</span></div>
            <p v-if="proof.captured" class="mt-3 text-xs leading-5 text-stone-500">Captured: {{ proof.captured }}<br />{{ proof.date }}</p>
            <p v-else class="mt-3 text-xs leading-5 text-stone-500">A captured photo will appear here.</p>
          </section>
        </div>
      </div>
    </section>

    <dl class="grid gap-3 sm:grid-cols-3">
      <div v-for="item in attendanceSummary" :key="item.label" class="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-stone-200 px-4 py-3"><dt class="text-xs text-stone-500">{{ item.label }}</dt><dd class="text-sm font-semibold text-stone-800">{{ item.value }}</dd></div>
    </dl>

    <section aria-labelledby="history-heading" class="rounded-xl border border-stone-200 bg-white p-5 sm:p-6">
      <h2 id="history-heading" class="text-lg font-semibold text-stone-900">Attendance History</h2>
      <p class="mt-1 text-sm leading-6 text-stone-500">Your seven most recent OJT days in this preview.</p>
      <table class="mt-5 hidden w-full text-left text-sm xl:table">
        <caption class="sr-only">Recent mock attendance records</caption>
        <thead class="border-y border-stone-200 bg-stone-50 text-xs text-stone-500"><tr><th scope="col" class="px-3 py-3 font-medium">Date</th><th scope="col" class="px-3 py-3 font-medium">Day</th><th scope="col" class="px-3 py-3 font-medium">Time In</th><th scope="col" class="px-3 py-3 font-medium">Time Out</th><th scope="col" class="px-3 py-3 font-medium">Hours</th><th scope="col" class="px-3 py-3 font-medium">Status</th></tr></thead>
        <tbody class="divide-y divide-stone-100"><tr v-for="record in attendanceHistory" :key="record.id"><th scope="row" class="px-3 py-4 font-medium text-stone-800">{{ record.date }}</th><td class="px-3 py-4 text-stone-500">{{ record.day }}</td><td class="px-3 py-4">{{ record.timeIn }}</td><td class="px-3 py-4">{{ record.timeOut }}</td><td class="px-3 py-4">{{ record.hours }}</td><td class="px-3 py-4"><span class="rounded-full px-2.5 py-1 text-xs font-medium" :class="badgeClass(record.status)">{{ record.status }}</span></td></tr></tbody>
      </table>
      <ul class="mt-5 space-y-3 xl:hidden">
        <li v-for="record in attendanceHistory" :key="record.id" class="rounded-lg border border-stone-200 p-4">
          <div class="flex flex-wrap items-start justify-between gap-2"><div><h3 class="text-sm font-semibold text-stone-800">{{ record.date }}</h3><p class="mt-1 text-xs text-stone-500">{{ record.day }}</p></div><span class="rounded-full px-2.5 py-1 text-xs font-medium" :class="badgeClass(record.status)">{{ record.status }}</span></div>
          <dl class="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt class="text-xs text-stone-500">Time In</dt><dd class="mt-1">{{ record.timeIn }}</dd></div><div><dt class="text-xs text-stone-500">Time Out</dt><dd class="mt-1">{{ record.timeOut }}</dd></div><div class="col-span-2 flex items-center justify-between gap-2 border-t border-stone-100 pt-3"><dt class="flex items-center gap-2 text-xs text-stone-500"><Clock3 :size="14" aria-hidden="true" />Rendered hours</dt><dd class="font-medium">{{ record.hours }}</dd></div></dl>
        </li>
      </ul>
    </section>
  </div>
</template>
