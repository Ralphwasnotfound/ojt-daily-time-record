<script>
import { ChevronDown, ChevronUp } from 'lucide-vue-next'
export default {
  name: 'ActivityDisclosure',
  components: { ChevronDown, ChevronUp },
  props: { id: { type: String, required: true }, expanded: Boolean },
  emits: ['update:expanded'],
}
</script>
<template>
  <section class="min-w-0 rounded-xl border border-stone-200 bg-white p-4 sm:p-5">
    <slot name="summary" />
    <button :id="id + '-toggle'" type="button" :aria-expanded="expanded" :aria-controls="id" class="mt-3 inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg px-2 text-left text-sm font-semibold text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand" @click="$emit('update:expanded', !expanded)">
      <component :is="expanded ? 'ChevronUp' : 'ChevronDown'" :size="16" class="shrink-0" aria-hidden="true" />
      {{ expanded ? 'Hide Activities' : 'View Activities' }}
    </button>
    <!-- Unmount on collapse so children clean up proof URLs and pending requests. -->
    <div v-if="expanded" :id="id" :aria-labelledby="id + '-toggle'" role="region" class="mt-3 min-w-0 border-t border-stone-200 pt-4"><slot /></div>
  </section>
</template>
