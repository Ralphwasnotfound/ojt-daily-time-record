<script>
export default {
  name: 'PlaceholderPage',
  props: {
    title: { type: String, required: true },
    description: { type: String, required: true },
  },
}
</script>

<template>
  <section class="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
    <p class="text-xs font-semibold uppercase tracking-wider text-brand">Phase 1 · Foundation</p>
    <h1 class="mt-3 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{{ title }}</h1>
    <p class="mt-3 max-w-2xl leading-7 text-slate-600">{{ description }}</p>
    <div class="mt-6"><slot /></div>
    <p class="mt-6 border-t border-slate-100 pt-4 text-sm text-slate-500">
      Placeholder screen. Features will be added in a later phase.
    </p>
  </section>
</template>
