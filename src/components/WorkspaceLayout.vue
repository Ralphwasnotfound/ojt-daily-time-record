<script>
import { ArrowLeft, Menu, X, UserRound, LogOut, LayoutDashboard, Clock, ClipboardPen, History, Users, Activity } from 'lucide-vue-next'

import logoUrl from '../assets/bsit-logo.png'
import LogoutDialog from './LogoutDialog.vue'
import { logout } from '../services/auth'

export default {
  name: 'WorkspaceLayout',
  components: { LogoutDialog, ArrowLeft, Menu, X, UserRound, LogOut, LayoutDashboard, Clock, ClipboardPen, History, Users, Activity },
  props: {
    role: { type: String, required: true },
    items: { type: Array, required: true },
  },
  data() {
    return {
      logoUrl,
      logoutOpen: false,
      signingOut: false,
      logoutError: '',
      drawerOpen: false,
      isDesktop: false,
      desktopQuery: null,
      previousOverflow: '',
    }
  },
  watch: {
    '$route.fullPath'() {
      if (this.drawerOpen) {
        this.closeDrawer(false)
        this.$nextTick(() => this.$refs.content.focus())
      }
    },
  },
  mounted() {
    this.desktopQuery = window.matchMedia('(min-width: 1024px)')
    this.isDesktop = this.desktopQuery.matches
    this.desktopQuery.addEventListener('change', this.updateViewport)
  },
  beforeUnmount() {
    this.desktopQuery.removeEventListener('change', this.updateViewport)
    if (this.drawerOpen) document.body.style.overflow = this.previousOverflow
  },
  methods: {
    openLogout() {
      if (this.drawerOpen) this.closeDrawer(false)
      this.logoutError = ''
      this.logoutOpen = true
    },
    cancelLogout() {
      if (this.signingOut) return
      this.logoutOpen = false
      this.$nextTick(() => {
        if (this.isDesktop || this.drawerOpen) this.$refs.logoutButton.focus()
        else this.$refs.menuButton.focus()
      })
    },
    async confirmLogout() {
      if (this.signingOut) return
      this.signingOut = true
      this.logoutError = ''
      try {
        await logout()
        this.logoutOpen = false
        await this.$router.replace('/')
      } catch {
        this.logoutError = 'Unable to log out. Please try again.'
      } finally {
        this.signingOut = false
      }
    },
    isSelected(item) {
      return this.$route.path === item.to || (!item.exact && this.$route.path.startsWith(item.to + '/'))
    },
    updateViewport(event) {
      const focusWasInside = this.$refs.sidebar.contains(document.activeElement)
      this.isDesktop = event.matches
      if (this.drawerOpen) this.closeDrawer(false)
      if (!this.isDesktop && focusWasInside) this.$nextTick(() => this.$refs.menuButton.focus())
    },
    openDrawer() {
      this.previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      this.drawerOpen = true
      this.$nextTick(() => this.$refs.closeButton.focus())
    },
    closeDrawer(restoreFocus = true) {
      this.drawerOpen = false
      document.body.style.overflow = this.previousOverflow
      if (restoreFocus) this.$nextTick(() => this.$refs.menuButton.focus())
    },
    handleKeydown(event) {
      if (!this.drawerOpen || this.isDesktop) return
      if (event.key === 'Escape') {
        event.preventDefault()
        this.closeDrawer()
      }
      if (event.key === 'Tab') {
        const elements = this.$refs.sidebar.querySelectorAll('a[href], button:not([disabled])')
        const first = elements[0]
        const last = elements[elements.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    },
  },
}
</script>

<template>
  <div class="min-h-dvh">
    <div v-if="drawerOpen && !isDesktop" class="fixed inset-0 z-40 bg-stone-950/50" aria-hidden="true" @click="closeDrawer()"></div>

    <aside
      v-show="isDesktop || drawerOpen"
      id="workspace-sidebar"
      ref="sidebar"
      :role="isDesktop ? undefined : 'dialog'"
      :aria-modal="isDesktop ? undefined : 'true'"
      :aria-label="role + ' navigation'"
      class="fixed inset-y-0 left-0 z-50 flex h-dvh w-72 max-w-[calc(100vw-2rem)] flex-col overflow-y-auto bg-brand text-white"
      @keydown="handleKeydown"
    >
      <div class="flex items-start justify-between gap-2 px-5 pt-6 pb-5">
        <div class="flex min-w-0 items-center gap-3">
          <img :src="logoUrl" alt="BSIT department logo" class="h-12 w-12 shrink-0 object-contain" />
          <div>
            <p class="text-base font-semibold tracking-tight">OJT Monitoring</p>
            <p class="mt-1 text-xs text-white/80">BSIT Department</p>
          </div>
        </div>
        <button v-if="!isDesktop" ref="closeButton" type="button" aria-label="Close navigation" class="sidebar-control -mr-2 -mt-2" @click="closeDrawer()">
          <X :size="20" aria-hidden="true" />
        </button>
      </div>

      <div class="mx-5 border-t border-white/15 pt-5">
        <p class="mb-3 px-3 text-xs font-semibold uppercase tracking-widest text-brand-gold">{{ role }} workspace</p>
        <nav :aria-label="role + ' pages'" class="space-y-1">
          <RouterLink
            v-for="item in items"
            :key="item.to"
            :to="item.to"
            :aria-current="isSelected(item) ? 'page' : undefined"
            class="sidebar-link"
            :class="{ 'sidebar-link-selected': isSelected(item) }"
          >
            <component :is="item.icon" :size="20" class="shrink-0" aria-hidden="true" />
            <span>{{ item.label }}</span>
          </RouterLink>
        </nav>
      </div>

      <div class="mt-auto px-5 pt-10 pb-6">
        <div class="space-y-1 border-t border-white/15 pt-4">
          <RouterLink :to="'/' + role.toLowerCase() + '/profile'" class="sidebar-link" :class="{ 'sidebar-link-selected': $route.path === '/' + role.toLowerCase() + '/profile' }"><UserRound :size="20" aria-hidden="true" />Profile</RouterLink>
          <button ref="logoutButton" type="button" class="sidebar-link w-full" @click="openLogout"><LogOut :size="20" aria-hidden="true" />Logout</button>
        </div>
      </div>
    </aside>

    <div :inert="drawerOpen && !isDesktop" class="min-h-dvh lg:pl-72">
      <a href="#main-content" class="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-lg focus:bg-white focus:p-4">Skip to content</a>
      <header class="flex min-h-18 items-center gap-3 border-b border-stone-200 bg-white px-4 sm:px-8">
        <button ref="menuButton" type="button" aria-label="Open navigation" aria-controls="workspace-sidebar" :aria-expanded="drawerOpen" class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-brand hover:bg-brand/5 lg:hidden" @click="openDrawer">
          <Menu :size="24" aria-hidden="true" />
        </button>
        <p class="text-sm font-medium text-stone-700">{{ role }} workspace</p>
        <span class="ml-auto rounded-full border border-brand-gold/40 bg-brand-gold/10 px-3 py-1 text-xs font-medium text-stone-700">Phase 1</span>
      </header>
      <main id="main-content" ref="content" tabindex="-1" class="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
        <slot />
      </main>
    </div>
    <LogoutDialog v-if="logoutOpen" :busy="signingOut" :error="logoutError" @cancel="cancelLogout" @confirm="confirmLogout" />
  </div>
</template>
