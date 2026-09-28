<script>
import { UserRound, LockKeyhole, Eye, EyeOff, ArrowRight } from 'lucide-vue-next'
import logoUrl from '../../assets/bsit-logo.png'

export default {
  name: 'LoginView',
  components: { UserRound, LockKeyhole, Eye, EyeOff, ArrowRight },
  data() {
    return {
      logoUrl,
      passwordVisible: false,
      notice: '',
    }
  },
  methods: {
    showSignInNotice() {
      this.notice = 'Sign-in is not connected yet. Use Development Preview below to explore a workspace.'
    },
    showRecoveryNotice() {
      this.notice = 'Password recovery is not available yet.'
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

        <form class="mt-6 space-y-5" aria-describedby="login-preview-note" @submit.prevent="showSignInNotice">
          <div>
            <label for="login-identifier" class="mb-2 block text-sm font-medium text-stone-700">Email / Student ID</label>
            <div class="relative">
              <UserRound :size="18" class="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-stone-400" aria-hidden="true" />
              <input id="login-identifier" name="username" type="text" autocomplete="username" autocapitalize="none" :spellcheck="false" required placeholder="Enter your email or student ID" class="min-h-12 w-full rounded-lg border border-stone-300 bg-white py-3 pr-3 pl-11 text-sm text-stone-900 placeholder:text-stone-400 focus:border-brand focus:ring-2 focus:ring-brand-gold/50 focus:outline-none" />
            </div>
          </div>

          <div>
            <label for="login-password" class="mb-2 block text-sm font-medium text-stone-700">Password</label>
            <div class="relative">
              <LockKeyhole :size="18" class="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-stone-400" aria-hidden="true" />
              <input id="login-password" name="password" :type="passwordVisible ? 'text' : 'password'" autocomplete="current-password" required placeholder="Enter your password" class="min-h-12 w-full rounded-lg border border-stone-300 bg-white py-3 pr-12 pl-11 text-sm text-stone-900 placeholder:text-stone-400 focus:border-brand focus:ring-2 focus:ring-brand-gold/50 focus:outline-none" />
              <button type="button" :aria-label="passwordVisible ? 'Hide password' : 'Show password'" aria-controls="login-password" class="absolute top-1/2 right-0.5 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md text-stone-500 hover:text-brand focus-visible:outline-offset-0" @click="passwordVisible = !passwordVisible">
                <EyeOff v-if="passwordVisible" :size="18" aria-hidden="true" />
                <Eye v-else :size="18" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
            <label for="remember-me" class="flex min-h-11 cursor-pointer items-center gap-2 text-stone-600">
              <input id="remember-me" type="checkbox" class="h-4 w-4 rounded border-stone-300 accent-brand" />
              Remember me
            </label>
            <a href="#login-notice" class="inline-flex min-h-11 items-center font-medium text-brand underline-offset-4 hover:underline" @click.prevent="showRecoveryNotice">Forgot password?</a>
          </div>

          <button type="submit" class="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-dark focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2">
            Sign In
            <ArrowRight :size="18" aria-hidden="true" />
          </button>
          <p id="login-preview-note" class="text-center text-xs leading-5 text-stone-500">UI preview only. Sign-in and remembered sessions are not connected yet.</p>
          <p id="login-notice" role="status" aria-live="polite" :class="notice ? 'rounded-lg border border-brand-gold/50 bg-brand-gold/10 p-3 text-sm leading-6 text-stone-700' : 'sr-only'">{{ notice }}</p>
        </form>

        <section aria-labelledby="preview-heading" class="mt-6 border-t border-stone-200 pt-5">
          <h2 id="preview-heading" class="text-xs font-semibold uppercase tracking-wider text-stone-500">Development Preview</h2>
          <nav aria-label="Development workspaces" class="mt-3 flex flex-col gap-2">
            <RouterLink to="/student" class="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-stone-200 px-3 py-2.5 text-sm font-medium text-stone-600 hover:border-stone-300 hover:bg-stone-50">
              Preview Student Workspace <ArrowRight :size="16" class="shrink-0 text-stone-400" aria-hidden="true" />
            </RouterLink>
            <RouterLink to="/admin" class="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-stone-200 px-3 py-2.5 text-sm font-medium text-stone-600 hover:border-stone-300 hover:bg-stone-50">
              Preview Admin Workspace <ArrowRight :size="16" class="shrink-0 text-stone-400" aria-hidden="true" />
            </RouterLink>
          </nav>
        </section>
      </section>

      <footer class="mt-6 text-center text-xs leading-5 text-stone-500">BSIT Department • OJT Monitoring System</footer>
    </div>
  </main>
</template>
