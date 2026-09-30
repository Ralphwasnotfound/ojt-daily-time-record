<script>
import studentAttendanceMixin from '../../services/studentAttendanceMixin.js'
import ActivityFeed from '../../components/ActivityFeed.vue'
import AttendanceFeedback from '../../components/AttendanceFeedback.vue'
import ExpandableList from '../../components/ExpandableList.vue'
import { Clock3 } from 'lucide-vue-next'

export default {
  name: 'HistoryView',
  mixins: [studentAttendanceMixin],
  components: { ActivityFeed, AttendanceFeedback, ExpandableList, Clock3 },
  data() {
    return {
      activeTab: this.$route?.query.tab === 'activity' ? 'activity' : 'attendance',
      selectedDate: '',
      tabs: [{ id: 'attendance', label: 'Attendance' }, { id: 'activity', label: 'Activity Updates' }],
      activityPageCount: null,
    }
  },
  computed: {
    summary() { return [...this.attendanceSummary.slice(0, 2).reverse(), { label: 'Activities on current page', value: this.activityPageCount ?? '--' }] },
    dateOptions() {
      const records = this.attendanceHistory
      return [...new Set(records.map(record => record.date))]
    },
    filteredAttendance() {
      return this.attendanceHistory.filter(record => !this.selectedDate || record.date === this.selectedDate)
    },

  },
  methods: {
    selectTab(id) {
      this.activeTab = id
      this.selectedDate = ''
    },
    moveTab(event, index) {
      let next
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') next = 1 - index
      else if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = 1
      else return
      event.preventDefault()
      this.selectTab(this.tabs[next].id)
      this.$nextTick(() => this.$refs.tabButtons[next].focus())
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
      <h1 class="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">History</h1>
      <p class="mt-2 text-sm leading-6 text-stone-600">Review your attendance and activity records.</p>
    </header>
    <p class="border-l-2 border-brand-gold pl-3 text-xs leading-5 text-stone-500">Attendance and activity updates come from your records. Attendance totals are not limited by the selected filter.</p>
    <AttendanceFeedback :state="attendanceUi" @refresh="refreshAttendance" /><dl class="grid gap-3 sm:grid-cols-3">
      <div v-for="item in summary" :key="item.label" class="rounded-lg border border-stone-200 bg-white px-4 py-3"><dt class="text-xs text-stone-500">{{ item.label }}</dt><dd class="mt-1 text-lg font-semibold text-stone-800">{{ item.value }}</dd></div>
    </dl>
    <section aria-label="History records" class="min-w-0 rounded-xl border border-stone-200 bg-white p-4 sm:p-6">
      <div role="tablist" aria-label="Record type" class="flex border-b border-stone-200">
        <button v-for="(tab, index) in tabs" :id="'tab-' + tab.id" :key="tab.id" ref="tabButtons" type="button" role="tab" :aria-selected="activeTab === tab.id" :aria-controls="'panel-' + tab.id" :tabindex="activeTab === tab.id ? 0 : -1" class="min-h-12 flex-1 border-b-2 px-2 py-3 text-sm font-semibold sm:flex-none sm:px-5" :class="activeTab === tab.id ? 'border-brand-gold text-brand' : 'border-transparent text-stone-500 hover:text-stone-800'" @click="selectTab(tab.id)" @keydown="moveTab($event, index)">{{ tab.label }}</button>
      </div>
      <div v-if="activeTab === 'attendance'" class="my-5 grid gap-4 sm:grid-cols-2">
        <div>
          <label for="history-date" class="mb-2 block text-sm font-medium text-stone-700">Date</label>
          <select id="history-date" v-model="selectedDate" class="min-h-11 w-full min-w-0 rounded-lg border border-stone-300 bg-white p-3 text-sm"><option value="">All Dates</option><option v-for="date in dateOptions" :key="date" :value="date">{{ date }}</option></select>
        </div>

      </div>
      <div v-show="activeTab === 'attendance'" id="panel-attendance" role="tabpanel" aria-labelledby="tab-attendance" tabindex="0">
        <h2 class="sr-only">Attendance records</h2>
      <p v-if="attendanceUi.ready && !filteredAttendance.length" role="status" class="mt-4 text-sm text-stone-500">No attendance matches this date.</p><ExpandableList v-if="attendanceUi.ready && filteredAttendance.length" :items="filteredAttendance" v-slot="{ visibleItems }">
<table class="mt-5 hidden w-full text-left text-sm xl:table">
        <caption class="sr-only">Recorded attendance in Asia/Manila</caption>
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

      </div>
      <div v-show="activeTab === 'activity'" id="panel-activity" role="tabpanel" aria-labelledby="tab-activity" tabindex="0">
        <h2 class="sr-only">Activity update records</h2>
        <ActivityFeed @loaded="activityPageCount = $event" />
      </div>
    </section>
  </div>
</template>
