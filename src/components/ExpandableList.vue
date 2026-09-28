<script>
import { ChevronDown, ChevronUp } from 'lucide-vue-next'

export default {
  name: 'ExpandableList',
  components: { ChevronDown, ChevronUp },
  props: {
    items: { type: Array, required: true },
  },
  data() {
    return { expanded: false }
  },
  computed: {
    visibleItems() {
      return this.expanded ? this.items : this.items.slice(0, 3)
    },
    hiddenCount() {
      return Math.max(0, this.items.length - 3)
    },
  },
  watch: {
    // Filtered arrays change when search/filter inputs change.
    items() { this.expanded = false },
  },
}
</script>

<template>
  <div>
    <slot :visible-items="visibleItems" />
    <div v-if="hiddenCount" class="mt-4 flex justify-center">
      <button
        type="button"
        :aria-expanded="expanded"
        class="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-stone-200 px-4 py-2 text-sm font-semibold text-brand hover:bg-stone-50"
        @click="expanded = !expanded"
      >
        {{ expanded ? 'Show Less' : 'Show More (' + hiddenCount + ')' }}
        <ChevronUp v-if="expanded" :size="16" aria-hidden="true" />
        <ChevronDown v-else :size="16" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
