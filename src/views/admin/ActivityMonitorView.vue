<script>
import AdminActivityStudents from '../../components/AdminActivityStudents.vue'
export default {
  name: 'ActivityMonitorView', components: { AdminActivityStudents },
  data() { return { activeTab: 'current' } },
  methods: {
    tabKey(event) {
      let next
      if (event.key === 'Home') next = 'current'
      else if (event.key === 'End') next = 'logs'
      else if (['ArrowLeft', 'ArrowRight'].includes(event.key)) next = this.activeTab === 'current' ? 'logs' : 'current'
      else return
      event.preventDefault(); this.activeTab = next
      this.$nextTick(() => this.$refs[next + 'Tab'].focus())
    },
  },
}
</script>
<template>
  <div class="space-y-6">
    <header><h1 class="text-2xl font-semibold text-stone-900 sm:text-3xl">Activity Monitor</h1><p class="mt-2 text-sm leading-6 text-stone-600">{{ activeTab === 'current' ? 'See what students are reporting.' : 'Review what students have changed.' }}</p></header>
    <div role="tablist" aria-label="Activity Monitor views" class="flex flex-wrap gap-2 border-b border-stone-200 pb-3" @keydown="tabKey">
      <button id="monitor-current-tab" ref="currentTab" type="button" role="tab" :aria-selected="activeTab === 'current'" aria-controls="monitor-current-panel" :tabindex="activeTab === 'current' ? 0 : -1" class="min-h-12 rounded-lg border px-4 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-gold" :class="activeTab === 'current' ? 'border-brand bg-brand text-white' : 'border-stone-200 bg-white text-stone-600'" @click="activeTab = 'current'">Current Activities</button>
      <button id="monitor-logs-tab" ref="logsTab" type="button" role="tab" :aria-selected="activeTab === 'logs'" aria-controls="monitor-logs-panel" :tabindex="activeTab === 'logs' ? 0 : -1" class="min-h-12 rounded-lg border px-4 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-gold" :class="activeTab === 'logs' ? 'border-brand bg-brand text-white' : 'border-stone-200 bg-white text-stone-600'" @click="activeTab = 'logs'">Activity Logs</button>
    </div>
    <section :id="'monitor-' + activeTab + '-panel'" :key="activeTab" role="tabpanel" :aria-labelledby="'monitor-' + activeTab + '-tab'" tabindex="0">
      <p v-if="activeTab === 'logs'" class="mb-4 text-xs text-stone-500">Includes unedited activities. Date filters use the original submission date.</p>
      <AdminActivityStudents :view-mode="activeTab" />
    </section>
  </div>
</template>
