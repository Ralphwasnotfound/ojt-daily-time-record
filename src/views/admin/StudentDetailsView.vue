<script>
import ExpandableList from '../../components/ExpandableList.vue'
import { UserRound, Image, Clock3, ArrowLeft } from 'lucide-vue-next'
export default {
  name: 'StudentDetailsView',
  components: { ExpandableList, UserRound, Image, Clock3, ArrowLeft },
  props: { id: { type: String, required: true } },
  data() {
    return {
      activeTab: 'overview',
      tabs: [{ id: 'overview', label: 'Overview' }, { id: 'attendance', label: 'Attendance' }, { id: 'activities', label: 'Activities' }],
      // Match the same sample identities as the Students page. Historical records are illustrative.
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
      attendanceHistory: [
  {
    "id": 1,
    "date": "September 25, 2026",
    "day": "Friday",
    "timeIn": "8:01 AM",
    "timeOut": "5:03 PM",
    "hours": "9h 02m",
    "status": "Complete"
  },
  {
    "id": 2,
    "date": "September 24, 2026",
    "day": "Thursday",
    "timeIn": "8:05 AM",
    "timeOut": "5:00 PM",
    "hours": "8h 55m",
    "status": "Complete"
  },
  {
    "id": 3,
    "date": "September 23, 2026",
    "day": "Wednesday",
    "timeIn": "8:00 AM",
    "timeOut": "--",
    "hours": "--",
    "status": "Incomplete"
  },
  {
    "id": 4,
    "date": "September 22, 2026",
    "day": "Tuesday",
    "timeIn": "7:58 AM",
    "timeOut": "5:02 PM",
    "hours": "9h 04m",
    "status": "Complete"
  },
  {
    "id": 5,
    "date": "September 21, 2026",
    "day": "Monday",
    "timeIn": "8:03 AM",
    "timeOut": "5:01 PM",
    "hours": "8h 58m",
    "status": "Complete"
  },
  {
    "id": 6,
    "date": "September 18, 2026",
    "day": "Friday",
    "timeIn": "8:02 AM",
    "timeOut": "5:00 PM",
    "hours": "8h 58m",
    "status": "Complete"
  },
  {
    "id": 7,
    "date": "September 17, 2026",
    "day": "Thursday",
    "timeIn": "8:00 AM",
    "timeOut": "5:00 PM",
    "hours": "9h 00m",
    "status": "Complete"
  }
],
      activityHistory: [
        { id: 1, date: 'September 28, 2026', time: '10:34 AM', category: 'Programming / Development', description: 'Worked on the responsive layout of the company website.', hasPhoto: true },
        { id: 2, date: 'September 28, 2026', time: '9:15 AM', category: 'IT Support', description: 'Helped the office team troubleshoot a printer connection.', hasPhoto: true },
        { id: 3, date: 'September 25, 2026', time: '3:20 PM', category: 'Documentation', description: 'Updated the inventory system user guide.', hasPhoto: true },
        { id: 4, date: 'September 24, 2026', time: '2:10 PM', category: 'Hardware / Maintenance', description: 'Assisted with workstation cleaning and equipment checks.', hasPhoto: false },
        { id: 5, date: 'September 23, 2026', time: '11:00 AM', category: 'Training / Seminar', description: 'Attended a session on workplace data security.', hasPhoto: true },
        { id: 6, date: 'September 22, 2026', time: '9:30 AM', category: 'Meeting', description: 'Joined the team planning meeting and noted assigned tasks.', hasPhoto: false },
      ],
    }
  },
  computed: {
    student() { return this.students.find(student => student.id === this.id) },
  },
  watch: { id() { this.activeTab = 'overview' } },
  methods: {
    moveTab(event, index) {
      let next
      if (event.key === 'ArrowRight') next = (index + 1) % this.tabs.length
      else if (event.key === 'ArrowLeft') next = (index + this.tabs.length - 1) % this.tabs.length
      else if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = this.tabs.length - 1
      else return
      event.preventDefault()
      this.activeTab = this.tabs[next].id
      this.$nextTick(() => this.$refs.tabButtons[next].focus())
    },
    badgeClass(status) { return status === 'Complete' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900' },
  },
}
</script>
<template>
  <div class="space-y-6">
    <RouterLink to="/admin/students" class="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-brand hover:bg-stone-50"><ArrowLeft :size="16" aria-hidden="true" />Back to Students</RouterLink>
    <template v-if="student">
      <header class="rounded-xl border border-stone-200 bg-white p-5 sm:p-6">
        <div class="flex flex-wrap items-center gap-4"><div class="flex h-14 w-14 items-center justify-center rounded-full bg-stone-100 text-brand"><UserRound :size="28" aria-hidden="true" /></div><div><h1 class="text-2xl font-semibold text-stone-900">{{ student.name }}</h1><p class="mt-1 text-sm text-stone-500">{{ student.id }}</p></div><div class="sm:ml-auto"><span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold" :class="student.status === 'IN' ? 'bg-emerald-50 text-emerald-800' : 'bg-stone-100 text-stone-600'"><span class="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true"></span>{{ student.status }}</span></div></div>
        <dl class="mt-5 grid gap-3 border-t border-stone-100 pt-4 text-sm sm:grid-cols-2"><div><dt class="text-stone-500">OJT Company</dt><dd class="mt-1 font-medium">{{ student.company }}</dd></div><div><dt class="text-stone-500">Required Hours</dt><dd class="mt-1 font-medium">{{ student.required }} hours</dd></div></dl>
      </header>
      <p class="border-l-2 border-brand-gold pl-3 text-xs leading-5 text-stone-500">Mock profile and illustrative history only. No live student records are loaded.</p>
      <div role="tablist" aria-label="Student records" class="flex border-b border-stone-200">
        <button v-for="(tab, index) in tabs" :id="'detail-tab-' + tab.id" :key="tab.id" ref="tabButtons" type="button" role="tab" :aria-selected="activeTab === tab.id" :aria-controls="'detail-panel-' + tab.id" :tabindex="activeTab === tab.id ? 0 : -1" class="min-h-12 flex-1 border-b-2 px-2 py-3 text-sm font-semibold sm:flex-none sm:px-5" :class="activeTab === tab.id ? 'border-brand-gold text-brand' : 'border-transparent text-stone-500'" @click="activeTab = tab.id" @keydown="moveTab($event, index)">{{ tab.label }}</button>
      </div>
      <section v-show="activeTab === 'overview'" id="detail-panel-overview" role="tabpanel" aria-labelledby="detail-tab-overview" tabindex="0" class="grid items-start gap-6 xl:grid-cols-2">
        <div class="rounded-xl border border-stone-200 bg-white p-5 sm:p-6"><h2 class="text-lg font-semibold">OJT Progress</h2>
          <dl class="mt-5 space-y-4 text-sm"><div class="flex flex-wrap justify-between gap-2"><dt class="text-stone-500">Completed Hours</dt><dd class="font-semibold">{{ student.hours }}</dd></div><div class="flex flex-wrap justify-between gap-2"><dt class="text-stone-500">Remaining Hours</dt><dd class="font-semibold">{{ student.remaining }}</dd></div><div class="flex justify-between gap-2"><dt class="text-stone-500">Required</dt><dd>{{ student.required }}h</dd></div></dl>
          <div role="progressbar" aria-label="OJT progress" :aria-valuenow="student.progress" aria-valuemin="0" aria-valuemax="100" class="mt-5 h-2 overflow-hidden rounded-full bg-stone-100"><div class="h-full bg-brand-gold" :style="{ width: student.progress + '%' }"></div></div><p class="mt-2 text-xs text-stone-500">{{ student.progress }}% complete (sample)</p>
          <dl class="mt-5 grid grid-cols-2 gap-3 border-t border-stone-100 pt-4"><div><dt class="text-xs text-stone-500">Days Present</dt><dd class="mt-1 text-xl font-semibold">{{ student.days }}</dd></div><div><dt class="text-xs text-stone-500">Activity Updates</dt><dd class="mt-1 text-xl font-semibold">{{ student.updates }}</dd></div></dl>
        </div>
        <div class="rounded-xl border border-stone-200 bg-white p-5 sm:p-6"><h2 class="text-lg font-semibold">Today's Attendance</h2><dl class="mt-5 space-y-3 text-sm"><div class="flex justify-between gap-2"><dt class="text-stone-500">Time In</dt><dd>{{ student.timeIn }}</dd></div><div class="flex justify-between gap-2"><dt class="text-stone-500">Time Out</dt><dd>{{ student.timeOut }}</dd></div><div class="flex flex-wrap justify-between gap-2"><dt class="text-stone-500">Current Status</dt><dd><span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold" :class="student.status === 'IN' ? 'bg-emerald-50 text-emerald-800' : 'bg-stone-100 text-stone-600'"><span class="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true"></span>{{ student.status }}</span></dd></div></dl>
          <div class="mt-5 grid gap-3 sm:grid-cols-2"><div v-for="label in ['Time In Photo Proof', 'Time Out Photo Proof']" :key="label" class="rounded-lg border border-stone-200 p-3"><h3 class="text-xs font-medium">{{ label }}</h3><div class="mt-3 flex h-24 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-stone-300 bg-stone-50 text-stone-400"><Image :size="24" aria-hidden="true" /><span class="text-xs">Photo placeholder</span></div></div></div>
        </div>
      </section>
      <section v-show="activeTab === 'attendance'" id="detail-panel-attendance" role="tabpanel" aria-labelledby="detail-tab-attendance" tabindex="0" class="rounded-xl border border-stone-200 bg-white p-4 sm:p-6"><h2 class="text-lg font-semibold">Attendance History</h2>
      <ExpandableList :items="attendanceHistory" v-slot="{ visibleItems }">
<table class="mt-5 hidden w-full text-left text-sm xl:table">
        <caption class="sr-only">Recent mock attendance records</caption>
        <thead class="border-y border-stone-200 bg-stone-50 text-xs text-stone-500"><tr><th scope="col" class="px-3 py-3 font-medium">Date</th><th scope="col" class="px-3 py-3 font-medium">Day</th><th scope="col" class="px-3 py-3 font-medium">Time In</th><th scope="col" class="px-3 py-3 font-medium">Time Out</th><th scope="col" class="px-3 py-3 font-medium">Hours</th><th scope="col" class="px-3 py-3 font-medium">Status</th></tr></thead>
        <tbody class="divide-y divide-stone-100"><tr v-for="record in visibleItems" :key="record.id"><th scope="row" class="px-3 py-4 font-medium text-stone-800">{{ record.date }}</th><td class="px-3 py-4 text-stone-500">{{ record.day }}</td><td class="px-3 py-4">{{ record.timeIn }}</td><td class="px-3 py-4">{{ record.timeOut }}</td><td class="px-3 py-4">{{ record.hours }}</td><td class="px-3 py-4"><span class="rounded-full px-2.5 py-1 text-xs font-medium" :class="badgeClass(record.status)">{{ record.status }}</span></td></tr></tbody>
      </table>
      <ul class="mt-5 space-y-3 xl:hidden">
        <li v-for="record in visibleItems" :key="record.id" class="rounded-lg border border-stone-200 p-4">
          <div class="flex flex-wrap items-start justify-between gap-2"><div><h3 class="text-sm font-semibold text-stone-800">{{ record.date }}</h3><p class="mt-1 text-xs text-stone-500">{{ record.day }}</p></div><span class="rounded-full px-2.5 py-1 text-xs font-medium" :class="badgeClass(record.status)">{{ record.status }}</span></div>
          <dl class="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt class="text-xs text-stone-500">Time In</dt><dd class="mt-1">{{ record.timeIn }}</dd></div><div><dt class="text-xs text-stone-500">Time Out</dt><dd class="mt-1">{{ record.timeOut }}</dd></div><div class="col-span-2 flex items-center justify-between gap-2 border-t border-stone-100 pt-3"><dt class="flex items-center gap-2 text-xs text-stone-500"><Clock3 :size="14" aria-hidden="true" />Rendered hours</dt><dd class="font-medium">{{ record.hours }}</dd></div></dl>
        </li>
      </ul>
</ExpandableList>


      </section>
      <section v-show="activeTab === 'activities'" id="detail-panel-activities" role="tabpanel" aria-labelledby="detail-tab-activities" tabindex="0"><h2 class="sr-only">Activity History</h2><ExpandableList :items="activityHistory" v-slot="{ visibleItems }">
<ul class="space-y-4"><li v-for="activity in visibleItems" :key="activity.id" class="rounded-xl border border-stone-200 bg-white p-5"><div class="flex flex-wrap justify-between gap-2 text-xs text-stone-500"><span>{{ activity.date }}</span><span>{{ activity.time }}</span></div><h3 class="mt-3 text-sm font-semibold text-brand">{{ activity.category }}</h3><p class="mt-2 text-sm leading-6 text-stone-600">{{ activity.description }}</p><p class="mt-3 flex items-center gap-2 text-xs text-stone-500"><Image :size="16" aria-hidden="true" />{{ activity.hasPhoto ? 'Photo attached' : 'No photo attached' }}</p></li></ul>
</ExpandableList></section>
    </template>
    <section v-else class="rounded-xl border border-stone-200 bg-white p-6"><h1 class="text-xl font-semibold">Student not found</h1><p class="mt-2 break-all text-sm text-stone-500">No mock student matches {{ id }}. Choose a sample from the Students page.</p></section>
  </div>
</template>
