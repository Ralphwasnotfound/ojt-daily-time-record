<script>
import ExpandableList from '../../components/ExpandableList.vue'
import { ClipboardList, Users, Image, Search } from 'lucide-vue-next'
export default {
  name: 'ActivityMonitorView',
  components: { ExpandableList, ClipboardList, Users, Image, Search },
  data() {
    return {
      searchQuery: '', activityFilter: '', statusFilter: '', dateFilter: '',
      summary: [{ label: "Today's Updates", value: 47, icon: 'ClipboardList' }, { label: 'Active Students', value: 24, icon: 'Users' }, { label: 'Photos Submitted', value: 39, icon: 'Image' }],
      categories: ["Programming / Development","IT Support","Hardware / Maintenance","Documentation","Training / Seminar","Meeting","Administrative Work","Other"],
      // Descending sample timestamps; Today/Yesterday refer to this fixed preview snapshot.
      activities: [
  {
    "id": 1,
    "name": "Ralph Joseph",
    "studentId": "2026-001",
    "status": "IN",
    "category": "Programming / Development",
    "description": "Worked on responsive layouts for the company website.",
    "time": "11:45 AM",
    "day": "Today",
    "date": "September 28, 2026",
    "hasPhoto": true
  },
  {
    "id": 2,
    "name": "Anna Reyes",
    "studentId": "2026-002",
    "status": "IN",
    "category": "IT Support",
    "description": "Resolved a printer connection issue for the office team.",
    "time": "11:20 AM",
    "day": "Today",
    "date": "September 28, 2026",
    "hasPhoto": true
  },
  {
    "id": 3,
    "name": "Mark Santos",
    "studentId": "2026-003",
    "status": "OUT",
    "category": "Hardware / Maintenance",
    "description": "Checked desktop hardware and cleaned workstations.",
    "time": "10:58 AM",
    "day": "Today",
    "date": "September 28, 2026",
    "hasPhoto": false
  },
  {
    "id": 4,
    "name": "Joshua Cruz",
    "studentId": "2026-004",
    "status": "IN",
    "category": "Documentation",
    "description": "Prepared inventory documentation and updated the equipment list.",
    "time": "10:34 AM",
    "day": "Today",
    "date": "September 28, 2026",
    "hasPhoto": true
  },
  {
    "id": 5,
    "name": "Maria Lopez",
    "studentId": "2026-005",
    "status": "IN",
    "category": "Training / Seminar",
    "description": "Joined a workplace security training session.",
    "time": "10:21 AM",
    "day": "Today",
    "date": "September 28, 2026",
    "hasPhoto": true
  },
  {
    "id": 6,
    "name": "Daniel Garcia",
    "studentId": "2026-006",
    "status": "IN",
    "category": "Meeting",
    "description": "Recorded action items from the project meeting.",
    "time": "9:48 AM",
    "day": "Today",
    "date": "September 28, 2026",
    "hasPhoto": false
  },
  {
    "id": 7,
    "name": "Sofia Ramos",
    "studentId": "2026-007",
    "status": "OUT",
    "category": "Administrative Work",
    "description": "Organized digital office records.",
    "time": "9:12 AM",
    "day": "Today",
    "date": "September 28, 2026",
    "hasPhoto": true
  },
  {
    "id": 8,
    "name": "Carlo Mendoza",
    "studentId": "2026-008",
    "status": "IN",
    "category": "Other",
    "description": "Assisted with daily IT service requests.",
    "time": "8:45 AM",
    "day": "Today",
    "date": "September 28, 2026",
    "hasPhoto": true
  },
  {
    "id": 9,
    "name": "Ralph Joseph",
    "studentId": "2026-001",
    "status": "IN",
    "category": "Programming / Development",
    "description": "Reviewed the website navigation on mobile screens.",
    "time": "3:30 PM",
    "day": "Yesterday",
    "date": "September 27, 2026",
    "hasPhoto": false
  },
  {
    "id": 10,
    "name": "Anna Reyes",
    "studentId": "2026-002",
    "status": "IN",
    "category": "IT Support",
    "description": "Updated the help desk troubleshooting guide.",
    "time": "2:15 PM",
    "day": "Yesterday",
    "date": "September 27, 2026",
    "hasPhoto": true
  }
],
    }
  },
  computed: {
    filteredActivities() {
      const query = this.searchQuery.trim().toLowerCase()
      return this.activities.filter(activity =>
        (activity.name.toLowerCase().includes(query) || activity.studentId.toLowerCase().includes(query)) &&
        (!this.activityFilter || activity.category === this.activityFilter) &&
        (!this.statusFilter || activity.status === this.statusFilter) &&
        (!this.dateFilter || activity.day === this.dateFilter))
    },
  },
}
</script>
<template>
  <div class="space-y-6">
    <header><h1 class="text-2xl font-semibold text-stone-900 sm:text-3xl">Activity Monitor</h1><p class="mt-2 text-sm leading-6 text-stone-600">View OJT activity updates submitted by students.</p></header>
    <p class="border-l-2 border-brand-gold pl-3 text-xs leading-5 text-stone-500">Static preview dated September 28, 2026. Today/Yesterday refer to this sample date; totals are illustrative. No live monitoring is enabled.</p>
    <dl class="grid gap-4 sm:grid-cols-3"><div v-for="item in summary" :key="item.label" class="rounded-xl border border-stone-200 bg-white p-5"><dt class="flex items-center justify-between gap-3 text-sm text-stone-500">{{ item.label }}<component :is="item.icon" :size="18" class="text-brand" aria-hidden="true" /></dt><dd class="mt-3 text-2xl font-semibold">{{ item.value }}</dd></div></dl>
    <section aria-label="Activity filters" class="grid gap-4 rounded-xl border border-stone-200 bg-white p-5 sm:grid-cols-2 xl:grid-cols-4">
      <div><label for="monitor-search" class="mb-2 block text-sm font-medium">Search Student</label><input id="monitor-search" v-model="searchQuery" type="search" placeholder="Student name or ID..." class="min-h-11 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-3 text-sm" /></div>
      <div><label for="monitor-category" class="mb-2 block text-sm font-medium">Activity Type</label><select id="monitor-category" v-model="activityFilter" class="min-h-11 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-3 text-sm"><option value="">All Activities</option><option v-for="category in categories" :key="category">{{ category }}</option></select></div>
      <div><label for="monitor-status" class="mb-2 block text-sm font-medium">Attendance Status</label><select id="monitor-status" v-model="statusFilter" class="min-h-11 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-3 text-sm"><option value="">All</option><option>IN</option><option>OUT</option></select></div>
      <div><label for="monitor-date" class="mb-2 block text-sm font-medium">Date</label><select id="monitor-date" v-model="dateFilter" class="min-h-11 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-3 text-sm"><option value="">All</option><option>Today</option><option>Yesterday</option></select></div>
    </section>
    <section aria-labelledby="feed-heading"><div class="flex flex-wrap items-center justify-between gap-2"><h2 id="feed-heading" class="text-lg font-semibold">Activity Submissions</h2><p role="status" class="text-xs text-stone-500">{{ filteredActivities.length }} sample updates · Newest first</p></div>
      <p v-if="!filteredActivities.length" class="mt-4 rounded-xl border border-stone-200 bg-white p-8 text-center text-sm text-stone-500">No activities match these filters.</p>
      <ExpandableList v-else :items="filteredActivities" v-slot="{ visibleItems }">
<ul class="mt-4 space-y-4"><li v-for="activity in visibleItems" :key="activity.id" class="rounded-xl border border-stone-200 bg-white p-5 sm:p-6">
        <div class="flex flex-col gap-4 sm:flex-row">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-start justify-between gap-3"><div><h3 class="text-sm font-semibold">{{ activity.name }}</h3><p class="mt-1 text-xs text-stone-500">{{ activity.studentId }}</p></div><span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold" :class="activity.status === 'IN' ? 'bg-emerald-50 text-emerald-800' : 'bg-stone-100 text-stone-600'"><span class="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true"></span>{{ activity.status }}</span></div>
            <p class="mt-3 text-xs text-stone-500">{{ activity.date }} · {{ activity.time }}</p>
            <h4 class="mt-3 text-sm font-semibold text-brand">{{ activity.category }}</h4><p class="mt-2 text-sm leading-6 text-stone-600">{{ activity.description }}</p>
            <p class="mt-3 text-xs text-stone-500">{{ activity.hasPhoto ? 'Photo attached (mock)' : 'No photo attached' }}</p>
          </div>
          <div v-if="activity.hasPhoto" class="flex min-h-28 shrink-0 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-stone-300 bg-stone-50 p-4 text-stone-400 sm:w-36"><Image :size="24" aria-hidden="true" /><span class="text-xs font-medium text-stone-500">Photo Proof</span><span class="text-xs">Placeholder</span></div>
        </div>
      </li></ul>
</ExpandableList>
    </section>
  </div>
</template>
