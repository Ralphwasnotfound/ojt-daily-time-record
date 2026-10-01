<script>
import studentAttendanceMixin from '../../services/studentAttendanceMixin.js'
import ActivityFeed from '../../components/ActivityFeed.vue'
import AttendanceFeedback from '../../components/AttendanceFeedback.vue'
import AttendanceDays from '../../components/AttendanceDays.vue'
import { Clock3 } from 'lucide-vue-next'

export default {
  name: 'HistoryView',
  mixins: [studentAttendanceMixin],
  components: { ActivityFeed, AttendanceFeedback, AttendanceDays, Clock3 },
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
      <div v-if="activeTab === 'attendance'" id="panel-attendance" role="tabpanel" aria-labelledby="tab-attendance" tabindex="0">
        <AttendanceDays :identity="attendanceEligible ? attendanceAccountKey : ''" :load="loadAttendanceDays" :refresh-key="attendanceUi.state" />
      </div>
      <div v-show="activeTab === 'activity'" id="panel-activity" role="tabpanel" aria-labelledby="tab-activity" tabindex="0">
        <h2 class="sr-only">Activity update records</h2>
        <ActivityFeed @loaded="activityPageCount = $event" />
      </div>
    </section>
  </div>
</template>
