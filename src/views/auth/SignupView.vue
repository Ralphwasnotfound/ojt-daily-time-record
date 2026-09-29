<script>
import LogoutDialog from '../../components/LogoutDialog.vue'
import logoUrl from '../../assets/bsit-logo.png'
import { registerStudent, authState, logout } from '../../services/auth'
import { validateSignup, accountDestination } from '../../services/accountPolicy'
export default {
  name: 'SignupView',
  components: { LogoutDialog },
  data() {
    return {
      logoUrl, busy: false, error: '', authState,
      logoutOpen: false, loggingOut: false, logoutError: '',
      form: { fullName: authState.user?.user_metadata?.full_name || authState.user?.user_metadata?.name || '', studentId: '', program: 'BS Information Technology' },
    }
  },
  methods: {
    async register() {
      if (this.busy) return
      this.error = validateSignup(this.form)
      if (this.error) return
      this.busy = true
      try {
        await registerStudent(this.form)
        await this.$router.replace(accountDestination(authState.user, authState.profile, authState.profileError))
      } catch (error) { this.error = error.message }
      finally { this.busy = false }
    },
    cancelLogout() {
      if (this.loggingOut) return
      this.logoutOpen = false
      this.$nextTick(() => this.$refs.logoutButton?.focus())
    },
    async confirmLogout() {
      if (this.loggingOut) return
      this.loggingOut = true
      this.logoutError = ''
      try { await logout(); this.logoutOpen = false; await this.$router.replace('/') }
      catch { this.logoutError = 'Unable to log out. Please try again.' }
      finally { this.loggingOut = false }
    },
  },
}
</script>
<template>
  <main class="min-h-dvh bg-stone-50 px-4 py-8 sm:py-12">
    <div class="mx-auto max-w-lg">
      <header class="mb-6 text-center"><img :src="logoUrl" alt="BSIT department logo" class="mx-auto h-20 w-20 object-contain" /><p class="mt-3 text-xl font-semibold text-brand">OJT Monitoring &amp; DTR</p><p class="mt-1 text-sm text-stone-500">BSIT Department</p></header>
      <section class="rounded-2xl border border-stone-200 bg-white p-5 sm:p-8">
        <h1 class="text-2xl font-semibold">Complete Registration</h1>
        <p class="mt-2 text-sm leading-6 text-stone-500">Confirm your student details for BSIT administrator review. Workspace access begins after approval.</p>
        <form class="mt-6 space-y-4" :aria-busy="busy" @submit.prevent="register">
          <fieldset :disabled="busy" class="space-y-4">
            <div><label for="signup-name" class="mb-2 block text-sm font-medium">Full Name</label><input id="signup-name" v-model="form.fullName" autocomplete="name" required maxlength="100" class="min-h-12 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-3 text-sm" /></div>
            <div><label for="signup-email" class="mb-2 block text-sm font-medium">Google email</label><input id="signup-email" :value="authState.user?.email || ''" type="email" readonly class="min-h-12 w-full min-w-0 rounded-lg border border-stone-300 bg-stone-50 px-3 py-3 text-sm" /><p class="mt-1 text-xs text-stone-500">Verified by your Google account; cannot be edited here.</p></div>
            <div><label for="signup-studentId" class="mb-2 block text-sm font-medium">Student ID</label><input id="signup-studentId" v-model="form.studentId" required maxlength="30" class="min-h-12 w-full min-w-0 rounded-lg border border-stone-300 px-3 py-3 text-sm" /></div>
            <div><label for="signup-program" class="mb-2 block text-sm font-medium">Program</label><input id="signup-program" :value="form.program" readonly class="min-h-12 w-full min-w-0 rounded-lg border border-stone-300 bg-stone-50 px-3 py-3 text-sm" /></div>
            <button type="submit" class="min-h-12 w-full rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60">{{ busy ? 'Submitting...' : 'Submit Registration' }}</button>
          </fieldset>
          <p v-if="error" role="alert" class="rounded-lg border border-brand-gold/50 bg-brand-gold/10 p-3 text-sm leading-6">{{ error }}</p>
        </form>
        <button ref="logoutButton" type="button" :disabled="busy" class="mt-4 min-h-11 text-sm font-semibold text-brand" @click="logoutOpen = true">Logout / Switch account</button>
      </section>
    </div>
    <LogoutDialog v-if="logoutOpen" :busy="loggingOut" :error="logoutError" @cancel="cancelLogout" @confirm="confirmLogout" />
  </main>
</template>
