<script>
import { Users, LogIn, LogOut, Search, ArrowRight } from 'lucide-vue-next'
export default {
  name: 'StudentsView',
  components: { Users, LogIn, LogOut, Search, ArrowRight },
  data() {
    return {
      searchQuery: '', statusFilter: '', activityFilter: '',
      summary: [{ label: 'Total Students', value: 32, icon: 'Users' }, { label: 'Currently IN', value: 24, icon: 'LogIn' }, { label: 'Currently OUT', value: 8, icon: 'LogOut' }],
      categories: ["Programming / Development","IT Support","Hardware / Maintenance","Documentation","Training / Seminar","Meeting","Administrative Work","Other"],
      students: [
  {
    "id": "2026-001",
    "name": "Ralph Joseph",
    "status": "IN",
    "timeIn": "8:02 AM",
    "activity": "Programming / Development",
    "hours": "126h 15m",
    "required": 486,
    "company": "ABC Technologies",
    "remaining": "359h 45m",
    "progress": 26,
    "days": 18,
    "updates": 42,
    "timeOut": "--"
  },
  {
    "id": "2026-002",
    "name": "Anna Reyes",
    "status": "IN",
    "timeIn": "7:55 AM",
    "activity": "IT Support",
    "hours": "120h 30m",
    "required": 486,
    "company": "Campus IT Services",
    "remaining": "365h 30m",
    "progress": 26,
    "days": 18,
    "updates": 42,
    "timeOut": "--"
  },
  {
    "id": "2026-003",
    "name": "Mark Santos",
    "status": "OUT",
    "timeIn": "8:00 AM",
    "activity": "Hardware / Maintenance",
    "hours": "122h 30m",
    "required": 486,
    "company": "Campus IT Services",
    "remaining": "363h 30m",
    "progress": 26,
    "days": 18,
    "updates": 42,
    "timeOut": "12:03 PM"
  },
  {
    "id": "2026-004",
    "name": "Joshua Cruz",
    "status": "IN",
    "timeIn": "8:11 AM",
    "activity": "Documentation",
    "hours": "124h 30m",
    "required": 486,
    "company": "Campus IT Services",
    "remaining": "361h 30m",
    "progress": 26,
    "days": 18,
    "updates": 42,
    "timeOut": "--"
  },
  {
    "id": "2026-005",
    "name": "Maria Lopez",
    "status": "IN",
    "timeIn": "8:04 AM",
    "activity": "Training / Seminar",
    "hours": "126h 30m",
    "required": 486,
    "company": "Campus IT Services",
    "remaining": "359h 30m",
    "progress": 26,
    "days": 18,
    "updates": 42,
    "timeOut": "--"
  },
  {
    "id": "2026-006",
    "name": "Daniel Garcia",
    "status": "IN",
    "timeIn": "7:59 AM",
    "activity": "Meeting",
    "hours": "128h 30m",
    "required": 486,
    "company": "Campus IT Services",
    "remaining": "357h 30m",
    "progress": 26,
    "days": 18,
    "updates": 42,
    "timeOut": "--"
  },
  {
    "id": "2026-007",
    "name": "Sofia Ramos",
    "status": "OUT",
    "timeIn": "8:06 AM",
    "activity": "Administrative Work",
    "hours": "130h 30m",
    "required": 486,
    "company": "Campus IT Services",
    "remaining": "355h 30m",
    "progress": 26,
    "days": 18,
    "updates": 42,
    "timeOut": "12:03 PM"
  },
  {
    "id": "2026-008",
    "name": "Carlo Mendoza",
    "status": "IN",
    "timeIn": "8:00 AM",
    "activity": "Other",
    "hours": "132h 30m",
    "required": 486,
    "company": "Campus IT Services",
    "remaining": "353h 30m",
    "progress": 26,
    "days": 18,
    "updates": 42,
    "timeOut": "--"
  }
],
    }
  },
  computed: {
    filteredStudents() {
      const query = this.searchQuery.trim().toLowerCase()
      return this.students.filter(student =>
        (student.name.toLowerCase().includes(query) || student.id.toLowerCase().includes(query)) &&
        (!this.statusFilter || student.status === this.statusFilter) &&
        (!this.activityFilter || student.activity === this.activityFilter))
    },
  },
}
</script>
<template>
  <div class="space-y-6">
    <header><h1 class="text-2xl font-semibold text-stone-900 sm:text-3xl">Students</h1><p class="mt-2 text-sm leading-6 text-stone-600">Monitor registered OJT students and their current attendance status.</p></header>
    <p class="border-l-2 border-brand-gold pl-3 text-xs leading-5 text-stone-500">Mock preview: eight sample students are shown. Class totals are illustrative and do not change with filters.</p>
    <dl class="grid gap-4 sm:grid-cols-3"><div v-for="item in summary" :key="item.label" class="rounded-xl border border-stone-200 bg-white p-5"><dt class="flex items-center justify-between gap-3 text-sm text-stone-500">{{ item.label }}<component :is="item.icon" :size="18" class="text-brand" aria-hidden="true" /></dt><dd class="mt-3 text-2xl font-semibold">{{ item.value }}</dd></div></dl>
    <section aria-label="Student records" class="min-w-0 rounded-xl border border-stone-200 bg-white p-4 sm:p-6">
      <div class="grid gap-4 md:grid-cols-3">
        <div><label for="student-search" class="mb-2 block text-sm font-medium">Search Students</label><div class="relative"><Search :size="16" class="absolute top-4 left-3 text-stone-400" aria-hidden="true" /><input id="student-search" v-model="searchQuery" type="search" placeholder="Search student name or ID..." class="min-h-11 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-3 text-sm pl-9" /></div></div>
        <div><label for="student-status" class="mb-2 block text-sm font-medium">Status</label><select id="student-status" v-model="statusFilter" class="min-h-11 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-3 text-sm"><option value="">All Students</option><option>IN</option><option>OUT</option></select></div>
        <div><label for="student-activity" class="mb-2 block text-sm font-medium">Activity Type</label><select id="student-activity" v-model="activityFilter" class="min-h-11 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-3 text-sm"><option value="">All Activities</option><option v-for="category in categories" :key="category">{{ category }}</option></select></div>
      </div>
      <p role="status" class="mt-5 text-xs text-stone-500">{{ filteredStudents.length }} sample students shown</p>
      <p v-if="!filteredStudents.length" class="py-8 text-center text-sm text-stone-500">No students match these filters.</p>
      <template v-else>
        <table class="mt-4 hidden w-full table-fixed text-left text-sm xl:table"><caption class="sr-only">Mock OJT student list</caption><thead class="border-y border-stone-200 bg-stone-50 text-xs text-stone-500"><tr><th scope="col" class="px-2 py-3 font-medium">Student</th><th scope="col" class="px-2 py-3 font-medium">Student ID</th><th scope="col" class="px-2 py-3 font-medium">Status</th><th scope="col" class="px-2 py-3 font-medium">Time In</th><th scope="col" class="px-2 py-3 font-medium">Current Activity</th><th scope="col" class="px-2 py-3 font-medium">OJT Hours</th><th scope="col" class="px-2 py-3 font-medium">Action</th></tr></thead>
          <tbody class="divide-y divide-stone-100"><tr v-for="student in filteredStudents" :key="student.id"><th scope="row" class="break-words px-2 py-4 font-semibold">{{ student.name }}</th><td class="px-2 py-4">{{ student.id }}</td><td class="px-2 py-4"><span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold" :class="student.status === 'IN' ? 'bg-emerald-50 text-emerald-800' : 'bg-stone-100 text-stone-600'"><span class="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true"></span>{{ student.status }}</span></td><td class="px-2 py-4">{{ student.timeIn }}</td><td class="break-words px-2 py-4 text-stone-600">{{ student.activity }}</td><td class="px-2 py-4">{{ student.hours }}<span class="block text-xs text-stone-500">/ {{ student.required }}h</span></td><td class="px-1 py-4"><RouterLink :to="'/admin/students/' + student.id" :aria-label="'View Details for ' + student.name" class="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-brand hover:bg-stone-50">View Details</RouterLink></td></tr></tbody>
        </table>
        <ul class="mt-4 space-y-3 xl:hidden"><li v-for="student in filteredStudents" :key="student.id" class="rounded-lg border border-stone-200 p-4"><div class="flex flex-wrap items-start justify-between gap-2"><div><h2 class="text-sm font-semibold">{{ student.name }}</h2><p class="mt-1 text-xs text-stone-500">{{ student.id }}</p></div><span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold" :class="student.status === 'IN' ? 'bg-emerald-50 text-emerald-800' : 'bg-stone-100 text-stone-600'"><span class="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true"></span>{{ student.status }}</span></div><dl class="mt-4 space-y-2 text-sm"><div><dt class="text-xs text-stone-500">Current / latest activity</dt><dd>{{ student.activity }}</dd></div><div class="flex flex-wrap justify-between gap-2"><dt class="text-stone-500">Time In</dt><dd>{{ student.timeIn }}</dd></div><div class="flex flex-wrap justify-between gap-2"><dt class="text-stone-500">OJT Hours</dt><dd>{{ student.hours }} / {{ student.required }}h</dd></div></dl><RouterLink :to="'/admin/students/' + student.id" :aria-label="'View Details for ' + student.name" class="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-brand hover:bg-stone-50 mt-3 w-full border border-stone-200">View Details<ArrowRight :size="16" aria-hidden="true" /></RouterLink></li></ul>
      </template>
    </section>
  </div>
</template>
