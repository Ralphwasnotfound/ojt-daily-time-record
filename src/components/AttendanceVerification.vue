<script>
import { Camera, X, RotateCcw, MapPin } from 'lucide-vue-next'
import { createAttendanceCamera, selfieError } from '../services/attendanceCapture.js'
import { attendanceProofApi } from '../services/supabaseAttendanceProofs.js'
import { attendanceProofState, createAttendanceProofController } from '../services/attendanceProofController.js'

export default {
  name: 'AttendanceVerification', components: { Camera, X, RotateCcw, MapPin },
  props: { action: { type: String, required: true }, owner: { type: String, required: true },
    eligible: Boolean, refresh: { type: Function, required: true }, recovery: { type: Object, default: null } },
  emits: ['saved', 'close', 'deferred'],
  data() { return { camera: null, controller: null, flow: attendanceProofState(), step: 'camera', ready: false,
    capturing: false, starting: false, error: '', blob: null, preview: '', alive: true, cameraVersion: 0 } },
  computed: {
    actionLabel() { return this.action === 'time_out' ? 'Time Out' : 'Time In' },
  },
  mounted() {
    this.$refs.dialog.showModal()
    this.camera = createAttendanceCamera(navigator.mediaDevices, window.isSecureContext)
    if (this.recovery) {
      this.flow.attempt = { ...this.recovery.attempt }
      this.flow.recoveryOnly = true; this.step = 'submit'
      this.flow.error = 'A previous verification is unresolved. Check its server result before recording attendance again.'
    }
    this.controller = createAttendanceProofController(this.flow, { api: attendanceProofApi(), owner: this.owner,
      action: this.action, allowed: () => this.eligible, refresh: this.refresh })
    document.addEventListener('visibilitychange', this.visibilityChanged)
    window.addEventListener('pagehide', this.pageHidden)
    if (!this.recovery) this.startCamera()
  },
  beforeUnmount() {
    this.alive = false; this.stopCamera(); this.clearImage(); this.controller?.stop()
    document.removeEventListener('visibilitychange', this.visibilityChanged)
    window.removeEventListener('pagehide', this.pageHidden)
    this.$refs.dialog.close()
  },
  methods: {
    clearImage() { if (this.preview) URL.revokeObjectURL(this.preview); this.preview = ''; this.blob = null },
    stopCamera() {
      this.cameraVersion++; this.camera?.stop(); this.ready = false; this.starting = false
      if (this.$refs.video) this.$refs.video.srcObject = null
    },
    async startCamera() {
      if (!this.alive || !this.eligible || this.starting || this.capturing || this.flow.attempt) return
      this.stopCamera(); const version = this.cameraVersion
      this.starting = true; this.error = ''; this.step = 'camera'
      await this.$nextTick()
      if (!this.alive || version !== this.cameraVersion) return
      try {
        const stream = await this.camera.start()
        if (!this.alive || version !== this.cameraVersion || !stream) { stream?.getTracks().forEach(track => track.stop()); return }
        this.$refs.video.srcObject = stream
        await this.$refs.video.play()
        if (this.alive && version === this.cameraVersion) this.ready = true
      } catch (error) {
        if (this.alive && version === this.cameraVersion) { this.stopCamera(); this.error = selfieError(error) }
      } finally { if (version === this.cameraVersion) this.starting = false }
    },
    async capture() {
      if (!this.ready || this.capturing) return
      this.capturing = true; this.error = ''; const version = this.cameraVersion
      try {
        const blob = await this.camera.capture(this.$refs.video)
        if (!this.alive || version !== this.cameraVersion) return
        this.clearImage(); this.blob = blob; this.preview = URL.createObjectURL(blob); this.step = 'preview'
      } catch (error) { if (this.alive && version === this.cameraVersion) this.error = selfieError(error) }
      finally { this.capturing = false; this.ready = false; if (this.$refs.video) this.$refs.video.srcObject = null }
    },
    retake() {
      if (this.flow.busy || this.flow.attempt) return
      this.clearImage(); this.startCamera()
    },
    async submit() {
      if (!this.blob || !this.eligible || this.flow.busy || this.flow.cancelling) return
      this.step = 'submit'
      await this.controller.submit(this.blob)
      if (this.alive && this.flow.saved) this.$emit('saved', this.flow.saved)
    },
    async cancel() {
      this.stopCamera()
      if (!this.controller || this.flow.cancelling) return
      const done = await this.controller.cancel()
      if (!this.alive || !done) return
      this.clearImage()
      if (this.flow.saved) this.$emit('saved', this.flow.saved)
      else this.$emit('close')
    },
    closeForNow() {
      if (!this.controller?.defer()) return
      this.stopCamera(); this.clearImage(); this.$emit('deferred')
    },
    visibilityChanged() {
      if (document.hidden && this.step === 'camera') {
        this.stopCamera(); this.error = 'Camera paused while this page was in the background. Resume when ready.'
      }
    },
    pageHidden() { this.stopCamera(); this.clearImage(); this.controller?.stop(); this.$emit('close') },
  },
}
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" aria-labelledby="attendance-verification-heading" aria-describedby="attendance-verification-help"
      class="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-xl bg-white p-5 text-stone-800 backdrop:bg-stone-950/50 sm:p-6"
      @cancel.prevent="cancel">
      <div class="flex items-center justify-between gap-3">
        <h2 id="attendance-verification-heading" class="text-lg font-semibold">Verify {{ actionLabel }}</h2>
        <button type="button" aria-label="Cancel verification" :disabled="flow.cancelling" class="flex min-h-11 min-w-11 items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50" @click="cancel"><X :size="20" aria-hidden="true" /></button>
      </div>
      <p id="attendance-verification-help" class="mt-2 text-sm leading-6 text-stone-600">Take a selfie to verify your attendance. Your current location is required for this attendance record.</p>
      <template v-if="step === 'camera'">
        <video ref="video" autoplay muted playsinline aria-label="Live selfie preview" class="mt-4 max-h-[45dvh] w-full rounded-lg bg-stone-950 object-contain"></video>
        <p v-if="starting" role="status" class="mt-3 text-sm">Waiting for camera access…</p>
        <p v-if="error" role="alert" class="mt-3 text-sm text-brand">{{ error }}</p>
        <button v-if="!ready && !starting" type="button" class="mt-3 min-h-11 rounded-lg border border-stone-300 px-4 text-sm font-semibold text-brand" @click="startCamera">Resume camera</button>
        <button type="button" :disabled="!ready || capturing" class="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50" @click="capture"><Camera :size="18" aria-hidden="true" />{{ capturing ? 'Capturing…' : 'Capture selfie' }}</button>
      </template>
      <template v-else>
        <img v-if="preview" :src="preview" alt="Captured attendance selfie preview" class="mt-4 max-h-[40dvh] w-full rounded-lg bg-stone-50 object-contain" />
        <div v-if="step === 'preview'" class="mt-4 grid grid-cols-2 gap-3">
          <button type="button" class="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-stone-300 px-3 text-sm font-semibold text-brand" @click="retake"><RotateCcw :size="17" aria-hidden="true" />Retake</button>
          <button type="button" class="min-h-12 rounded-lg bg-brand px-3 text-sm font-semibold text-white hover:bg-brand-dark" @click="submit">Continue</button>
        </div>
        <template v-else>
          <p v-if="flow.phase && !flow.cancelling" role="status" aria-live="polite" class="mt-4 flex items-center gap-2 text-sm"><MapPin :size="18" aria-hidden="true" />{{ flow.phase }}</p>
          <p v-if="flow.error" role="alert" class="mt-3 rounded-lg border border-brand-gold/50 bg-brand-gold/10 p-3 text-sm leading-6">{{ flow.error }}</p>
          <p v-if="flow.unresolved" class="mt-2 text-xs leading-5 text-stone-600">Your verification is retained. Retry checks the same submission; it does not start a new punch.</p>
          <button v-if="!flow.blocked && !flow.saved" type="button" :disabled="flow.busy || flow.cancelling" :aria-busy="flow.busy || flow.cancelling" class="mt-4 min-h-12 w-full rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50" @click="flow.recoveryOnly ? cancel() : submit()">{{ flow.busy || flow.cancelling ? 'Verification in progress…' : flow.recoveryOnly ? 'Check result and close' : 'Retry verification' }}</button>
        </template>
      </template>
      <button type="button" :disabled="flow.cancelling" class="mt-3 min-h-11 w-full rounded-lg border border-stone-300 px-4 text-sm font-semibold disabled:opacity-50" @click="cancel">{{ flow.cancelling ? 'Checking cancellation…' : 'Cancel' }}</button>
      <button v-if="flow.cancelFailed && !flow.busy && !flow.cancelling" type="button" class="mt-3 min-h-11 w-full rounded-lg border border-stone-300 px-4 text-sm font-semibold text-brand" @click="closeForNow">Close for now</button>
      <p class="mt-3 text-xs leading-5 text-stone-500">Selfie and location are stored privately. The server records the official attendance time when submission succeeds.</p>
    </dialog>
  </Teleport>
</template>
