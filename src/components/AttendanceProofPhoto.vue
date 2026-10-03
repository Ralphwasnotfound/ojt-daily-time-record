<script>
export default {
  name: 'AttendanceProofPhoto',
  props: {
    src: { type: String, required: true },
    display: { type: Object, required: true },
    loading: { type: Boolean, default: false },
  },
  emits: ['load', 'error'],
  data() { return { inspectingOriginal: false } },
  watch: { src() { this.inspectingOriginal = false } },
}
</script>

<template>
  <div class="bg-stone-100 p-3">
    <p v-if="loading" role="status" class="text-center text-sm text-stone-500">Loading selfie…</p>
    <div class="flex justify-center">
      <div class="proof-photo-frame">
        <img :src="src" alt="Private attendance selfie" class="proof-photo-image object-contain" @load="$emit('load')" @error="$emit('error')" />
        <div v-if="!loading && !inspectingOriginal" class="proof-photo-watermark" aria-label="Attendance photo evidence summary">
          <p class="proof-photo-brand">BSIT–TCC · OJT ATTENDANCE PROOF</p>
          <p class="proof-photo-action">{{ display.action }} · {{ display.session }}</p>
          <p class="proof-photo-time">{{ display.date }} · {{ display.time }} · Manila</p>
        </div>
      </div>
    </div>
    <div class="mt-2 flex justify-end">
      <button type="button" :disabled="loading" :aria-pressed="inspectingOriginal" aria-label="Inspect original selfie without presentation watermark" class="min-h-11 rounded-lg border border-stone-300 bg-white px-3 text-sm font-semibold text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50" @click="inspectingOriginal = !inspectingOriginal">{{ inspectingOriginal ? 'Return to evidence view' : 'Inspect original' }}</button>
    </div>
  </div>
</template>

<style scoped>
.proof-photo-frame { position: relative; display: inline-grid; max-width: 100%; min-width: 0; overflow: hidden; }
.proof-photo-image { display: block; width: auto; height: auto; max-width: 100%; max-height: 45dvh; }
.proof-photo-watermark { position: absolute; inset: auto 0 0; padding: 6px 8px; border-top: 1px solid #f0cb69; background: linear-gradient(180deg, rgb(100 19 33 / 90%), rgb(40 8 15 / 96%)); color: white; overflow-wrap: anywhere; pointer-events: none; }
.proof-photo-brand { color: #f0cb69; font-size: 9px; line-height: 1.3; font-weight: 600; }
.proof-photo-action { margin-top: 3px; font-size: 12px; line-height: 1.3; font-weight: 700; }
.proof-photo-time { margin-top: 3px; font-size: 10px; line-height: 1.35; }
@media (min-width: 640px) { .proof-photo-watermark { padding: 10px 12px; } .proof-photo-brand { font-size: 11px; } .proof-photo-action { font-size: 14px; } .proof-photo-time { font-size: 12px; } }
</style>
