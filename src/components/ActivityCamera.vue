<script>
import { Camera, X } from 'lucide-vue-next'
import { createActivityCamera, cameraError } from '../services/activityPhoto.js'
export default {
  name: 'ActivityCamera', components: { Camera, X }, emits: ['capture', 'close'],
  data() { return { camera: null, ready: false, busy: false, error: '', alive: true } },
  async mounted() {
    this.$refs.dialog.showModal()
    document.addEventListener('visibilitychange', this.visibilityChanged)
    this.camera = createActivityCamera(navigator.mediaDevices, window.isSecureContext)
    try {
      const stream = await this.camera.start()
      if (!this.alive || !stream) return
      this.$refs.video.srcObject = stream
      await this.$refs.video.play()
      if (this.alive) this.ready = true
    } catch (error) { this.camera.stop(); if (this.alive) this.error = cameraError(error) }
  },
  beforeUnmount() {
    this.alive = false; this.camera?.stop()
    document.removeEventListener('visibilitychange', this.visibilityChanged)
    this.$refs.dialog.close()
  },
  methods: {
    close() { this.camera?.stop(); this.$emit('close') },
    visibilityChanged() { if (document.hidden) this.close() },
    async capture() {
      if (!this.ready || this.busy) return
      this.busy = true
      try {
        const file = await this.camera.capture(this.$refs.video)
        if (this.alive) this.$emit('capture', file)
      } catch (error) { if (this.alive) { this.error = cameraError(error); this.ready = false } }
      finally { this.busy = false }
    },
  },
}
</script>
<template>
  <Teleport to="body">
    <dialog ref="dialog" aria-labelledby="activity-camera-heading" class="m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl bg-white p-5 text-stone-800 backdrop:bg-stone-950/50" @cancel.prevent="close" @close="camera?.stop()">
      <div class="flex items-center justify-between gap-3"><h2 id="activity-camera-heading" class="text-lg font-semibold">Take activity photo</h2><button type="button" aria-label="Close camera" class="min-h-11 min-w-11 p-2" @click="close"><X :size="20" /></button></div>
      <video ref="video" autoplay muted playsinline aria-label="Live camera preview" class="mt-3 aspect-[4/3] w-full rounded-lg bg-stone-950 object-contain"></video>
      <p v-if="error" role="alert" class="mt-3 text-sm text-brand">{{ error }}</p>
      <p v-else-if="!ready" role="status" class="mt-3 text-sm">Waiting for camera access…</p>
      <div class="mt-4 flex justify-end gap-3"><button type="button" class="min-h-12 rounded-lg border px-4" @click="close">Cancel</button><button type="button" :disabled="!ready || busy" class="inline-flex min-h-12 items-center gap-2 rounded-lg bg-brand px-4 text-white disabled:opacity-50" @click="capture"><Camera :size="18" />Capture</button></div>
    </dialog>
  </Teleport>
</template>
