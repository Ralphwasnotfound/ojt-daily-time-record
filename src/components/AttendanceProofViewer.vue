<script>
import { Eye, X, ShieldCheck } from 'lucide-vue-next'
import logoUrl from '../assets/bsit-logo.png'
import { adminKey } from '../services/supabaseAdmin.js'
import { adminAttendanceProofApi, formatProof } from '../services/adminAttendanceProof.js'
import { studentAttendanceProofApi, studentProofKey } from '../services/studentAttendanceProof.js'
import { checkPhoto } from '../services/activityPhoto.js'

export default {
  name: 'AttendanceProofViewer',
  components: { Eye, X, ShieldCheck },
  props: { studentUid: { type: String, required: true }, sessionId: { type: String, required: true }, action: { type: String, required: true }, audience: { type: String, default: 'admin', validator: value => ['admin', 'student'].includes(value) } },
  data() { return { logoUrl, open: false, loading: false, imageLoading: false, error: '', missing: false, evidence: null, url: '', generation: 0, abort: null, previousOverflow: null } },
  computed: {
    accountKey() { return this.audience === 'student' ? studentProofKey() : adminKey() },
    proofApi() { return this.audience === 'student' ? studentAttendanceProofApi : adminAttendanceProofApi },
    display() { return this.evidence ? formatProof(this.evidence) : null },
    actionLabel() { return this.action === 'time_in' ? 'Time In' : 'Time Out' },
  },
  watch: { accountKey() { this.close() }, studentUid() { this.close() }, sessionId() { this.close() }, action() { this.close() }, audience() { this.close() }, '$route.fullPath'() { this.close() } },
  beforeUnmount() { this.close() },
  methods: {
    clear() {
      this.generation++; this.abort?.abort(); this.abort = null
      if (this.url) URL.revokeObjectURL(this.url)
      this.url = ''; this.evidence = null; this.loading = false; this.imageLoading = false; this.error = ''; this.missing = false
    },
    close() {
      this.clear(); this.open = false; this.$refs.dialog?.close()
      if (this.previousOverflow !== null) { document.body.style.overflow = this.previousOverflow; this.previousOverflow = null }
    },
    async show() {
      if (this.open || !this.accountKey) return
      this.open = true
      this.previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'
      await this.$nextTick()
      if (!this.open) return
      this.$refs.dialog.showModal(); this.$refs.close.focus()
      await this.load()
    },
    async load() {
      this.clear()
      if (!this.open || !this.accountKey) return
      const version = this.generation, key = this.accountKey, abort = new AbortController()
      this.abort = abort; this.loading = true
      let timer
      try {
        const result = await Promise.race([
          (async () => {
            const evidence = await this.proofApi.evidence(this.studentUid, this.sessionId, this.action, abort.signal)
            if (!evidence) return null
            const blob = await this.proofApi.download(evidence.proof.photo_path, abort.signal)
            checkPhoto(blob)
            return { evidence, blob }
          })(),
          new Promise((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error('TIMEOUT')) }, 20000) }),
        ])
        if (version !== this.generation || !this.open || key !== this.accountKey) return
        if (!result) { this.missing = true; return }
        this.evidence = result.evidence; this.imageLoading = true; this.url = URL.createObjectURL(result.blob)
      } catch {
        if (version === this.generation) this.error = 'Unable to load this attendance proof. Check your connection and account access, then retry.'
      } finally { clearTimeout(timer); if (version === this.generation) this.loading = false }
    },
    imageFailed() {
      if (this.url) URL.revokeObjectURL(this.url)
      this.url = ''; this.imageLoading = false
      this.error = 'The private selfie could not be displayed. Please retry.'
    },
  },
}
</script>
<template>
  <button type="button" :aria-label="`View ${actionLabel} Proof`" class="mt-1 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-brand hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-brand" @click="show"><Eye :size="16" aria-hidden="true" />View Proof</button>
  <Teleport v-if="open" to="body">
    <dialog ref="dialog" aria-label="Attendance proof" class="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-xl border border-stone-200 bg-stone-50 p-0 text-stone-900 backdrop:bg-stone-950/60" @cancel.prevent="close">
      <div class="flex items-center justify-between gap-3 border-b border-stone-200 bg-white px-4 py-2 sm:px-6"><h2 class="font-semibold">Attendance proof</h2><button ref="close" type="button" aria-label="Close attendance proof" class="flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-stone-100" @click="close"><X :size="20" /></button></div>
      <div class="space-y-4 p-4 sm:p-6">
        <p v-if="loading" role="status" class="py-8 text-center text-sm">Loading private attendance proof…</p>
        <p v-if="missing" role="status" class="py-8 text-sm text-stone-600">No attendance proof is available for this historical record.</p>
        <div v-if="error" role="alert" class="rounded-lg border border-stone-200 bg-white p-4 text-sm"><p>{{ error }}</p><button type="button" class="mt-2 min-h-11 rounded-lg border border-stone-300 px-4 font-semibold text-brand" @click="load">Retry</button></div>
        <article v-if="display && url" aria-label="Branded attendance evidence" class="overflow-hidden rounded-xl border border-stone-200 bg-white">
          <header class="flex items-center gap-3 border-b-2 border-brand-gold bg-brand p-4 text-white"><img :src="logoUrl" alt="BSIT department logo" class="h-16 w-16 shrink-0 object-contain" /><div class="min-w-0"><p class="text-xs text-white/80">Torres Capitol College</p><h3 class="mt-1 text-base font-semibold sm:text-lg">OJT Monitoring &amp; DTR</h3><p class="mt-1 text-xs text-white/80">BSIT Department · Attendance evidence</p></div></header>
          <div class="bg-stone-100 p-3"><p v-if="imageLoading" role="status" class="text-center text-sm text-stone-500">Loading selfie…</p><img :src="url" alt="Private attendance selfie" class="mx-auto max-h-[45dvh] w-full object-contain" @load="imageLoading = false" @error="imageFailed" /></div>
          <div class="space-y-4 border-t-2 border-brand-gold p-4 sm:p-5"><div class="flex flex-wrap items-start justify-between gap-3"><div class="min-w-0"><h4 class="break-words text-lg font-semibold">{{ display.fullName }}</h4><p class="mt-1 break-words text-sm text-stone-600">Student ID · {{ display.studentId }}</p></div><p class="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white">{{ display.action }} · {{ display.session }}</p></div>
            <dl class="grid gap-4 text-sm sm:grid-cols-2"><div><dt class="text-xs text-stone-500">Official server date · Manila</dt><dd class="mt-1 font-medium">{{ display.date }}</dd></div><div><dt class="text-xs text-stone-500">Official server time · Manila</dt><dd class="mt-1 font-medium">{{ display.time }}</dd></div><div><dt class="text-xs text-stone-500">Recorded coordinates</dt><dd class="mt-1 break-words font-medium">{{ display.location }}</dd></div><div><dt class="text-xs text-stone-500">Reported accuracy</dt><dd class="mt-1 font-medium">{{ display.accuracy }}</dd></div></dl>
            <p class="flex items-center gap-2 border-t border-stone-100 pt-3 text-xs font-medium text-brand"><ShieldCheck :size="16" aria-hidden="true" />Private proof · Finalized attendance record</p>
          </div>
        </article>
        <p v-if="display && url" class="text-xs leading-5 text-stone-500">Review presentation generated from the original selfie and database metadata. The database remains authoritative. A browser selfie and reported location do not independently prove physical presence.</p>
        <div class="flex justify-end"><button type="button" class="min-h-11 rounded-lg border border-stone-300 bg-white px-5 text-sm font-semibold text-brand" @click="close">Close</button></div>
      </div>
    </dialog>
  </Teleport>
</template>
