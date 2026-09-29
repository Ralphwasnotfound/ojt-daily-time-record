<script>
import { LogIn } from 'lucide-vue-next'
import { loginWithGoogle, loginErrorMessage, authState } from '../../services/auth'
import logoUrl from '../../assets/bsit-logo.png'
export default {
  name: 'LoginView',
  components: { LogIn },
  data() { return { logoUrl, notice: authState.loginNotice, signingIn: false } },
  methods: {
    async signIn() {
      if (this.signingIn) return
      this.notice = ''
      this.signingIn = true
      try {
        await loginWithGoogle()
        // Supabase redirects to Google. Routing happens after the callback restores a session.
      } catch (error) {
        this.notice = loginErrorMessage(error)
        this.signingIn = false
      }
    },
  },
}
</script>
<template>
  <main class="flex min-h-dvh flex-col items-center justify-center bg-stone-50 px-4 py-8 sm:py-12">
    <div class="w-full max-w-md">
      <header class="mb-7 text-center">
        <img :src="logoUrl" alt="BSIT department logo" class="mx-auto h-24 w-24 object-contain sm:h-28 sm:w-28" />
        <p class="mt-4 text-xl font-semibold tracking-tight text-brand sm:text-2xl">OJT Monitoring &amp; DTR</p>
        <p class="mt-1 text-sm text-stone-500">BSIT Department</p>
        <div class="mx-auto mt-5 h-1 w-12 rounded-full bg-brand-gold" aria-hidden="true"></div>
      </header>

      <section aria-labelledby="login-heading" class="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-8">
        <h1 id="login-heading" class="text-2xl font-semibold tracking-tight text-stone-900">Welcome Back</h1>
        <p class="mt-2 text-sm leading-6 text-stone-500">Sign in to access your OJT workspace.</p>

        <button type="button" :disabled="signingIn" :aria-busy="signingIn" class="mt-6 flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-stone-800 hover:bg-stone-50 focus-visible:ring-2 focus-visible:ring-brand-gold disabled:opacity-60" @click="signIn">
          <LogIn :size="18" aria-hidden="true" />
          {{ signingIn ? 'Connecting to Google...' : 'Continue with Google' }}
        </button>
        <p class="mt-4 text-sm leading-6 text-stone-500">New students complete registration after Google sign-in. Workspace access requires administrator approval.</p>
        <p v-if="notice" role="alert" class="mt-4 rounded-lg border border-brand-gold/50 bg-brand-gold/10 p-3 text-sm leading-6 text-stone-700">{{ notice }}</p>
      </section>

      <footer class="mt-6 text-center text-xs leading-5 text-stone-500">BSIT Department • OJT Monitoring System</footer>
    </div>
  </main>
</template>

