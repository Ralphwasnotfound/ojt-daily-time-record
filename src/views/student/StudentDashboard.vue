<script>
import { Plus, ArrowRight, Clock3, CalendarDays, GraduationCap, LogIn, LogOut, CodeXml, FileText, Headphones, Image } from 'lucide-vue-next'

export default {
  name: 'StudentDashboard',
  components: { Plus, ArrowRight, Clock3, CalendarDays, GraduationCap, LogIn, LogOut, CodeXml, FileText, Headphones, Image },
  data() {
    return {
      // Static preview snapshot; replace with student records in a later phase.
      dashboard: {
        studentName: 'Ralph',
        date: new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
        status: 'IN',
        statusSince: '8:02 AM',
        todayHours: '4h 32m',
        totalHours: '126h 15m',
        requiredHours: 486,
        progressPercent: 26,
        attendance: { timeIn: '8:02 AM', timeOut: '--' },
        activities: [
          { id: 1, category: 'Programming', icon: 'CodeXml', description: 'Worked on the company website and fixed responsive layouts.', time: '12:10 PM', hasPhoto: true },
          { id: 2, category: 'Documentation', icon: 'FileText', description: 'Updated the user guide with screenshots of the inventory system.', time: '10:34 AM', hasPhoto: true },
          { id: 3, category: 'IT Support', icon: 'Headphones', description: 'Helped the office team troubleshoot a printer connection.', time: '9:15 AM', hasPhoto: false },
        ],
      },
    }
  },
}
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-brand">Your OJT overview</p>
        <h1 class="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">Good afternoon, {{ dashboard.studentName }}</h1>
        <p class="mt-2 flex items-center gap-2 text-sm text-stone-500"><CalendarDays :size="16" class="shrink-0" aria-hidden="true" />{{ dashboard.date }}</p>
      </div>
      <RouterLink to="/student/activity" class="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-dark">
        <Plus :size="18" aria-hidden="true" />Add Activity Update
      </RouterLink>
    </header>

    <p class="border-l-2 border-brand-gold pl-3 text-xs leading-5 text-stone-500">Sample dashboard data for preview. Hours and attendance are not live.</p>

    <section aria-label="OJT summary" class="grid gap-4 md:grid-cols-3">
      <article class="rounded-xl border border-stone-200 bg-white p-5">
        <h2 class="text-xs font-semibold uppercase tracking-wider text-stone-500">Current Status</h2>
        <p class="mt-4 flex items-center gap-3 text-3xl font-semibold text-stone-900">
          <span class="h-2.5 w-2.5 rounded-full" :class="dashboard.status === 'IN' ? 'bg-emerald-600' : 'bg-stone-400'" aria-hidden="true"></span>{{ dashboard.status }}
        </p>
        <p class="mt-2 text-sm text-stone-500">Since {{ dashboard.statusSince }}</p>
      </article>
      <article class="rounded-xl border border-stone-200 bg-white p-5">
        <div class="flex items-center justify-between gap-2"><h2 class="text-xs font-semibold uppercase tracking-wider text-stone-500">Today's Hours</h2><Clock3 :size="18" class="text-brand" aria-hidden="true" /></div>
        <p class="mt-4 text-3xl font-semibold tracking-tight text-stone-900">{{ dashboard.todayHours }}</p>
        <p class="mt-2 text-sm text-stone-500">Today</p>
      </article>
      <article class="rounded-xl border border-stone-200 bg-white p-5">
        <div class="flex items-center justify-between gap-2"><h2 class="text-xs font-semibold uppercase tracking-wider text-stone-500">Total OJT Hours</h2><GraduationCap :size="18" class="text-brand" aria-hidden="true" /></div>
        <p class="mt-4 text-3xl font-semibold tracking-tight text-stone-900">{{ dashboard.totalHours }}</p>
        <p class="mt-2 text-sm text-stone-500">{{ dashboard.requiredHours }} hours required</p>
        <div role="progressbar" aria-label="OJT hours completed" :aria-valuenow="dashboard.progressPercent" aria-valuemin="0" aria-valuemax="100" class="mt-4 h-1.5 overflow-hidden rounded-full bg-stone-100">
          <div class="h-full rounded-full bg-brand-gold" :style="{ width: dashboard.progressPercent + '%' }"></div>
        </div>
        <p class="mt-2 text-xs text-stone-500">{{ dashboard.progressPercent }}% complete</p>
      </article>
    </section>

    <div class="grid items-start gap-6 xl:grid-cols-5">
      <section aria-labelledby="attendance-heading" class="rounded-xl border border-stone-200 bg-white p-5 sm:p-6 xl:col-span-2">
        <h2 id="attendance-heading" class="text-lg font-semibold text-stone-900">Today's Attendance</h2>
        <p class="mt-1 text-sm text-stone-500">Your daily attendance at a glance.</p>
        <dl class="mt-5 divide-y divide-stone-100">
          <div class="flex items-center justify-between gap-3 py-4"><dt class="flex items-center gap-3 text-sm text-stone-500"><LogIn :size="18" aria-hidden="true" />Time In</dt><dd class="font-semibold text-stone-800">{{ dashboard.attendance.timeIn }}</dd></div>
          <div class="flex items-center justify-between gap-3 py-4"><dt class="flex items-center gap-3 text-sm text-stone-500"><LogOut :size="18" aria-hidden="true" />Time Out</dt><dd class="font-semibold text-stone-800">{{ dashboard.attendance.timeOut }}</dd></div>
          <div class="flex items-center justify-between gap-3 py-4"><dt class="text-sm text-stone-500">Current status</dt><dd class="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold" :class="dashboard.status === 'IN' ? 'bg-emerald-50 text-emerald-800' : 'bg-stone-100 text-stone-600'"><span class="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true"></span>{{ dashboard.status }}</dd></div>
        </dl>
        <RouterLink to="/student/attendance" class="mt-4 flex min-h-11 items-center justify-center gap-2 rounded-lg border border-stone-200 px-4 py-3 text-sm font-semibold text-brand hover:bg-stone-50">View Attendance<ArrowRight :size="16" aria-hidden="true" /></RouterLink>
      </section>

      <section aria-labelledby="activity-heading" class="rounded-xl border border-stone-200 bg-white p-5 sm:p-6 xl:col-span-3">
        <h2 id="activity-heading" class="text-lg font-semibold text-stone-900">Recent Activity</h2>
        <p class="mt-1 text-sm text-stone-500">A snapshot of your latest work today.</p>
        <ul class="mt-2 divide-y divide-stone-100">
          <li v-for="activity in dashboard.activities" :key="activity.id" class="flex gap-3 py-5 last:pb-0">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-stone-50 text-brand"><component :is="activity.icon" :size="18" aria-hidden="true" /></span>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"><h3 class="text-sm font-semibold text-stone-800">{{ activity.category }}</h3><span class="text-xs text-stone-500">{{ activity.time }}</span></div>
              <p class="mt-2 text-sm leading-6 text-stone-600">{{ activity.description }}</p>
              <p v-if="activity.hasPhoto" class="mt-2 flex items-center gap-1.5 text-xs text-stone-500"><Image :size="14" aria-hidden="true" />Photo attached</p>
            </div>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
