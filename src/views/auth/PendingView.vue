<script>
import LogoutDialog from '../../components/LogoutDialog.vue'
import { authState, refreshProfile, logout } from '../../services/auth'
import { accountDestination } from '../../services/accountPolicy'
import logoUrl from '../../assets/bsit-logo.png'
export default {
  name: 'PendingView',
  components: { LogoutDialog },
  data() { return { authState, logoUrl, logoutOpen: false, busy: false, logoutError: '' } },
  computed: {
    title() {
      if (authState.profileError) return 'Unable to Load Account'
      if (!authState.profile) return 'Account Profile Missing'
      if (authState.profile.role === 'student' && authState.profile.status === 'pending') return 'Account Pending Approval'
      if (authState.profile.status === 'rejected') return 'Registration Not Approved'
      return 'Account Access Unavailable'
    },
    description() {
      if (authState.profileError) return authState.profileError
      if (!authState.profile) return 'Your sign-in account has no application profile. Contact the BSIT administrator; workspace access has not been granted.'
      if (authState.profile.status === 'pending' && authState.profile.role === 'student') return 'Your registration has been submitted. Please wait for the BSIT administrator to approve your account.'
      if (authState.profile.status === 'rejected') return 'Your registration was not approved. Contact the BSIT administrator for assistance.'
      return 'Your account role or status does not allow workspace access. Contact the BSIT administrator.'
    },
  },
  methods: {
    async checkStatus() {
      await refreshProfile()
      await this.$router.replace(accountDestination(authState.user, authState.profile, authState.profileError))
    },
    cancelLogout() {
      if (this.busy) return
      this.logoutOpen = false
      this.$nextTick(() => this.$refs.logoutButton.focus())
    },
    async confirmLogout() {
      if (this.busy) return
      this.busy = true
      this.logoutError = ''
      try { await logout(); this.logoutOpen = false; await this.$router.replace('/') }
      catch { this.logoutError = 'Unable to log out. Please try again.' }
      finally { this.busy = false }
    },
  },
}
</script>
<template>
  <main class="flex min-h-dvh items-center justify-center px-4 py-8">
    <section class="w-full max-w-lg rounded-2xl border border-stone-200 bg-white p-6 sm:p-8">
      <img :src="logoUrl" alt="BSIT department logo" class="h-16 w-16 object-contain" />
      <p class="mt-4 text-sm font-semibold text-brand">BSIT Department</p><h1 class="mt-2 text-2xl font-semibold">{{ title }}</h1><p class="mt-3 text-sm leading-6 text-stone-600">{{ description }}</p>
      <dl class="mt-6 space-y-3 border-t border-stone-200 pt-4 text-sm">
        <div v-if="authState.profile"><dt class="text-stone-500">Full Name</dt><dd class="break-words">{{ authState.profile.fullName }}</dd></div>
        <div v-if="authState.profile?.studentId"><dt class="text-stone-500">Student ID</dt><dd>{{ authState.profile.studentId }}</dd></div>
        <div><dt class="text-stone-500">Email</dt><dd class="break-all">{{ authState.user?.email }}</dd></div>
      </dl>
      <div class="mt-6 flex flex-wrap gap-3"><button type="button" class="min-h-12 rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-white" @click="checkStatus">Check Account Status</button><button ref="logoutButton" type="button" class="min-h-12 rounded-lg border border-stone-300 px-4 py-3 text-sm font-semibold text-brand" @click="logoutOpen = true">Logout</button></div>
    </section>
    <LogoutDialog v-if="logoutOpen" :busy="busy" :error="logoutError" @cancel="cancelLogout" @confirm="confirmLogout" />
  </main>
</template>
