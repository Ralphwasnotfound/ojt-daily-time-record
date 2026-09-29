<script>
export default {
  name: 'AttendanceFeedback',
  props: { state: { type: Object, required: true } },
  emits: ['refresh'],
}
</script>
<template>
  <div class="flex flex-wrap items-center justify-between gap-3 text-sm">
    <div class="min-w-0 flex-1">
      <p v-if="state.busy" role="status" class="text-stone-600">Recording attendance. Waiting for server confirmation…</p>
      <p v-else-if="state.loading" role="status" class="text-stone-600">Loading attendance history and calculating completed hours…</p>
      <p v-if="state.error" role="alert" class="rounded-lg border border-brand-gold/50 bg-brand-gold/10 p-3 text-stone-700">{{ state.error }}</p>
      <p v-if="state.notice" role="status" class="mt-2 text-stone-700">{{ state.notice }}</p>
    </div>
    <button type="button" :disabled="state.busy || state.loading" class="min-h-11 rounded-lg border border-stone-300 px-4 py-2 font-semibold text-brand disabled:opacity-50" @click="$emit('refresh')">Refresh attendance</button>
  </div>
</template>
