<script>
import { CalendarDays, Users, LogIn, LogOut, ClipboardList, ArrowRight, Image, CircleAlert } from 'lucide-vue-next'

export default {
  name: 'AdminDashboard',
  components: { CalendarDays, Users, LogIn, LogOut, ClipboardList, ArrowRight, Image, CircleAlert },
  data() {
    return {
      date: new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
      // Static preview records, not live attendance or calculated class totals.
      stats: [
        { label: 'Total Students', value: 32, icon: 'Users' },
        { label: 'Currently IN', value: 24, icon: 'LogIn' },
        { label: 'Currently OUT', value: 8, icon: 'LogOut' },
        { label: "Today's Activity Updates", value: 47, icon: 'ClipboardList' },
      ],
      students: [
        { id: 1, name: 'Ralph Joseph', status: 'IN', time: '8:02 AM', event: 'Time In' },
        { id: 2, name: 'Anna Reyes', status: 'IN', time: '7:55 AM', event: 'Time In' },
        { id: 3, name: 'Mark Santos', status: 'OUT', time: '12:03 PM', event: 'Time Out' },
        { id: 4, name: 'Joshua Cruz', status: 'IN', time: '8:11 AM', event: 'Time In' },
      ],
      recentActivities: [
        { id: 1, student: 'Ralph Joseph', category: 'Programming', description: 'Working on the company website.', time: '10:34 AM', hasPhoto: true },
        { id: 2, student: 'Anna Reyes', category: 'Documentation', description: 'Prepared inventory documentation.', time: '10:21 AM', hasPhoto: true },
        { id: 3, student: 'Mark Santos', category: 'IT Support', description: 'Configured workstation network settings.', time: '9:48 AM', hasPhoto: false },
      ],
      attentionItems: [
        { id: 1, count: 3, description: 'students have not timed in today' },
        { id: 2, count: 1, description: 'student has an incomplete Time Out record' },
      ],
    }
  },
}
</script>

<template>
  <div class="space-y-6">
    <header>
      <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-brand">Class overview</p>
      <h1 class="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">Admin Dashboard</h1>
      <p class="mt-2 text-sm leading-6 text-stone-600">Monitor student attendance and OJT activity.</p>
      <p class="mt-3 flex items-center gap-2 text-sm text-stone-500"><CalendarDays :size="16" class="shrink-0" aria-hidden="true" />{{ date }}</p>
    </header>

    <p class="border-l-2 border-brand-gold pl-3 text-xs leading-5 text-stone-500">Sample dashboard data for preview. Class totals, attendance, and attention items are not live.</p>

    <section aria-label="Class summary" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <article v-for="stat in stats" :key="stat.label" class="rounded-xl border border-stone-200 bg-white p-5">
        <div class="flex items-start justify-between gap-3">
          <h2 class="text-xs font-semibold uppercase leading-5 tracking-wider text-stone-500">{{ stat.label }}</h2>
          <component :is="stat.icon" :size="18" class="shrink-0 text-brand" aria-hidden="true" />
        </div>
        <p class="mt-4 text-3xl font-semibold text-stone-900">{{ stat.value }}</p>
      </article>
    </section>

    <div class="grid items-start gap-6 xl:grid-cols-2">
      <section aria-labelledby="students-heading" class="min-w-0 rounded-xl border border-stone-200 bg-white p-5 sm:p-6">
        <h2 id="students-heading" class="text-lg font-semibold text-stone-900">Student Status</h2>
        <p class="mt-1 text-sm leading-6 text-stone-500">A snapshot of student attendance.</p>
        <ul class="mt-4 divide-y divide-stone-100">
          <li v-for="student in students" :key="student.id" class="flex flex-wrap items-center justify-between gap-3 py-4">
            <div class="min-w-0">
              <h3 class="break-words text-sm font-semibold text-stone-800">{{ student.name }}</h3>
              <p class="mt-1 text-xs leading-5 text-stone-500">{{ student.event }} · {{ student.time }}</p>
            </div>
            <span class="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold" :class="student.status === 'IN' ? 'bg-emerald-50 text-emerald-800' : 'bg-stone-100 text-stone-600'">
              <span class="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true"></span>{{ student.status }}
            </span>
          </li>
        </ul>
        <RouterLink to="/admin/students" class="mt-4 flex min-h-11 items-center justify-center gap-2 rounded-lg border border-stone-200 px-4 py-3 text-sm font-semibold text-brand hover:bg-stone-50">View All Students<ArrowRight :size="16" aria-hidden="true" /></RouterLink>
      </section>

      <section aria-labelledby="recent-heading" class="min-w-0 rounded-xl border border-stone-200 bg-white p-5 sm:p-6">
        <h2 id="recent-heading" class="text-lg font-semibold text-stone-900">Recent Activity</h2>
        <p class="mt-1 text-sm leading-6 text-stone-500">Latest submissions from the class.</p>
        <ul class="mt-4 divide-y divide-stone-100">
          <li v-for="activity in recentActivities" :key="activity.id" class="py-4">
            <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <h3 class="text-sm font-semibold text-stone-800">{{ activity.student }}</h3>
              <span class="text-xs text-stone-500">{{ activity.time }}</span>
            </div>
            <p class="mt-1 text-xs font-medium text-brand">{{ activity.category }}</p>
            <p class="mt-2 text-sm leading-6 text-stone-600">{{ activity.description }}</p>
            <p v-if="activity.hasPhoto" class="mt-2 flex items-center gap-1.5 text-xs text-stone-500"><Image :size="14" aria-hidden="true" />Photo attached</p>
          </li>
        </ul>
        <RouterLink to="/admin/activity" class="mt-4 flex min-h-11 items-center justify-center gap-2 rounded-lg border border-stone-200 px-4 py-3 text-sm font-semibold text-brand hover:bg-stone-50">View Activity Monitor<ArrowRight :size="16" aria-hidden="true" /></RouterLink>
      </section>
    </div>

    <section aria-labelledby="attention-heading" class="rounded-xl border border-stone-200 bg-white p-5 sm:p-6">
      <div class="flex items-center gap-2"><CircleAlert :size="18" class="text-brand" aria-hidden="true" /><h2 id="attention-heading" class="text-lg font-semibold text-stone-900">Needs Attention</h2></div>
      <ul class="mt-4 grid gap-3 sm:grid-cols-2">
        <li v-for="item in attentionItems" :key="item.id" class="border-l-2 border-brand-gold bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-600"><span class="font-semibold text-stone-900">{{ item.count }}</span> {{ item.description }}.</li>
      </ul>
      <p class="mt-3 text-xs text-stone-500">Informational examples only; no automatic detection is enabled.</p>
    </section>
  </div>
</template>
