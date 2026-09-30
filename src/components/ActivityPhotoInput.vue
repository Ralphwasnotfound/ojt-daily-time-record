<script>
import { Camera, Image, X } from 'lucide-vue-next'
import ActivityCamera from './ActivityCamera.vue'
import { validatePhoto } from '../services/activityPhoto.js'
import { activityError } from '../services/supabaseActivityData.js'
export default {
  name: 'ActivityPhotoInput', components: { ActivityCamera, Camera, Image, X },
  props: { file: { default: null }, disabled: Boolean }, emits: ['update:file', 'validating'],
  data() { return { preview: '', error: '', cameraOpen: false, validating: false, version: 0, captured: false } },
  watch: {
    file: { immediate: true, handler(file) { if (this.preview) URL.revokeObjectURL(this.preview); this.preview = file ? URL.createObjectURL(file) : '' } },
    validating(value) { this.$emit('validating', value) },
    disabled(value) { if (value) { this.cameraOpen = false; this.version++; this.validating = false } },
  },
  beforeUnmount() { this.version++; if (this.preview) URL.revokeObjectURL(this.preview) },
  methods: {
    async accept(file, captured = false) {
      this.cameraOpen = false
      if (!file || this.disabled) return
      const version = ++this.version
      this.validating = true; this.error = ''
      try {
        await validatePhoto(file)
        if (version === this.version && !this.disabled) { this.captured = captured; this.$emit('update:file', file) }
      } catch (error) { if (version === this.version) this.error = activityError(error) }
      finally { if (version === this.version) this.validating = false }
    },
    choose(event) { const file = event.target.files?.[0]; event.target.value = ''; this.accept(file) },
    remove() { this.version++; this.validating = false; this.error = ''; this.$emit('update:file', null) },
  },
}
</script>
<template>
  <div>
    <div class="mt-5 flex aspect-[4/3] flex-col items-center justify-center gap-3 overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50 text-center">
      <img v-if="preview" :src="preview" alt="Selected activity proof preview" class="h-full w-full object-contain" />
      <template v-else><Camera :size="36" class="text-stone-400" aria-hidden="true" /><p class="px-4 text-sm text-stone-600">Your photo preview will appear here</p><p class="text-xs text-stone-500">No replacement selected</p></template>
    </div>
    <input ref="input" type="file" accept="image/jpeg,image/png,image/webp" class="sr-only" tabindex="-1" aria-label="Choose activity photo" :disabled="disabled || validating" @change="choose" />
    <div class="mt-4 grid gap-3 sm:grid-cols-2">
      <button type="button" :disabled="disabled || validating" class="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white disabled:opacity-50" @click="cameraOpen = true"><Camera :size="18" aria-hidden="true" />{{ captured && file ? 'Retake' : 'Take Photo' }}</button>
      <button type="button" :disabled="disabled || validating" class="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-stone-300 px-4 text-sm font-semibold text-stone-700 disabled:opacity-50" @click="$refs.input.click()"><Image :size="18" aria-hidden="true" />Choose Photo</button>
    </div>
    <button v-if="file" type="button" :disabled="disabled" class="mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand disabled:opacity-50" @click="remove"><X :size="16" aria-hidden="true" />Remove selection</button>
    <p v-if="validating" role="status" class="mt-2 text-sm">Checking image…</p>
    <p v-if="error" role="alert" class="mt-2 text-sm text-brand">{{ error }}</p>
    <p class="mt-3 text-xs text-stone-500">JPEG, PNG or WebP · up to 5 MiB. Take a photo or choose an existing image.</p>
    <ActivityCamera v-if="cameraOpen" @close="cameraOpen = false" @capture="accept($event, true)" />
  </div>
</template>
