<script>
import { Eye, EyeOff } from 'lucide-vue-next'
import logoUrl from '../../assets/bsit-logo.png'
import { registerStudent, authState, logout } from '../../services/auth'
import { validateSignup, yearLevels, accountDestination } from '../../services/accountPolicy'
export default {
  name: 'SignupView',
  components: { Eye, EyeOff },
  data() {
    return {
      logoUrl, yearLevels, busy: false, showPassword: false, error: '', authState,
      form: { fullName: '', studentId: '', email: '', program: 'BS Information Technology', yearLevel: '4th Year', password: '', confirmPassword: '' },
    }
  },
  methods: {
    async register() {
      if (this.busy) return
      this.form.email = this.form.email.trim()
      this.error = validateSignup(this.form)
      if (this.error) return
      this.busy = true
      try {
        await registerStudent(this.form)
        this.form.password = ''
        this.form.confirmPassword = ''
        await this.$router.replace(accountDestination(authState.user, authState.profile, authState.profileError))
      } catch (error) {
        this.error = error.message
      } finally { this.busy = false }
    },
    async leaveAccount() {
      try { await logout(); await this.$router.replace('/') } catch { this.error = 'Unable to log out. Please try again.' }
    },
  },
}
</script>
<template>
  <main class="min-h-dvh bg-stone-50 px-4 py-8 sm:py-12">
    <div class="mx-auto max-w-lg">
      <header class="mb-6 text-center"><img :src="logoUrl" alt="BSIT department logo" class="mx-auto h-20 w-20 object-contain" /><p class="mt-3 text-xl font-semibold text-brand">OJT Monitoring &amp; DTR</p><p class="mt-1 text-sm text-stone-500">BSIT Department</p></header>
      <section class="rounded-2xl border border-stone-200 bg-white p-5 sm:p-8">
        <h1 class="text-2xl font-semibold">Student Registration</h1><p class="mt-2 text-sm leading-6 text-stone-500">Create your account for administrator review. Workspace access begins after approval.</p>
        <form class="mt-6 space-y-4" :aria-busy="busy" @submit.prevent="register">
          <fieldset :disabled="busy || !!authState.user" class="space-y-4">
          <div><label for="signup-fullName" class="mb-2 block text-sm font-medium">Full Name</label><input id="signup-fullName" v-model="form.fullName" type="text" autocomplete="name" required maxlength="100" class="min-h-12 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-3 text-sm" /></div>
<div><label for="signup-studentId" class="mb-2 block text-sm font-medium">Student ID</label><input id="signup-studentId" v-model="form.studentId" type="text" autocomplete="off" required maxlength="30" class="min-h-12 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-3 text-sm" /></div>
<div><label for="signup-email" class="mb-2 block text-sm font-medium">Email Address</label><input id="signup-email" v-model="form.email" type="email" autocomplete="email" required maxlength="254" class="min-h-12 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-3 text-sm" /></div>
          <div><label for="signup-program" class="mb-2 block text-sm font-medium">Program</label><input id="signup-program" v-model="form.program" readonly class="min-h-12 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-3 text-sm bg-stone-50" /></div>
          <div><label for="signup-year" class="mb-2 block text-sm font-medium">Year Level</label><select id="signup-year" v-model="form.yearLevel" class="min-h-12 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-3 text-sm"><option v-for="year in yearLevels" :key="year">{{ year }}</option></select></div>
          <div><label for="signup-password" class="mb-2 block text-sm font-medium">Password</label><div class="relative"><input id="signup-password" v-model="form.password" :type="showPassword ? 'text' : 'password'" autocomplete="new-password" required minlength="8" class="min-h-12 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-3 text-sm pr-12" /><button type="button" :aria-label="showPassword ? 'Hide passwords' : 'Show passwords'" class="absolute top-0 right-0 flex h-12 w-12 items-center justify-center text-stone-500" @click="showPassword = !showPassword"><EyeOff v-if="showPassword" :size="18" aria-hidden="true" /><Eye v-else :size="18" aria-hidden="true" /></button></div><p class="mt-1 text-xs text-stone-500">At least 8 characters; your project's password policy also applies.</p></div>
          <div><label for="signup-confirm" class="mb-2 block text-sm font-medium">Confirm Password</label><input id="signup-confirm" v-model="form.confirmPassword" :type="showPassword ? 'text' : 'password'" autocomplete="new-password" required class="min-h-12 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-3 text-sm" /></div>
          <button type="submit" class="min-h-12 w-full rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60">{{ busy ? 'Creating account...' : 'Register as Student' }}</button>
          </fieldset>
          <p v-if="error" role="alert" class="rounded-lg border border-brand-gold/50 bg-brand-gold/10 p-3 text-sm leading-6">{{ error }}</p>
        </form>
        <button v-if="authState.user && !busy" type="button" class="mt-4 min-h-11 text-sm font-semibold text-brand" @click="leaveAccount">Log out and return to Login</button>
        <RouterLink v-else to="/" class="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-brand underline underline-offset-4">Back to Login</RouterLink>
      </section>
    </div>
  </main>
</template>
