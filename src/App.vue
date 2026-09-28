<script>
import { authState } from './services/auth'

export default {
  name: 'App',
  data() {
    return { authState }
  },
  methods: {
    reload() { window.location.reload() },
  },
}
</script>

<template>
  <main v-if="authState.error" class="flex min-h-dvh items-center justify-center p-6">
    <div class="max-w-md rounded-xl border border-stone-200 bg-white p-6">
      <p role="alert" class="text-sm text-stone-700">{{ authState.error }}</p>
      <button type="button" class="mt-4 min-h-11 rounded-lg bg-brand px-4 py-2 text-white" @click="reload">Reload</button>
    </div>
  </main>
  <main v-else-if="!authState.initialized || !$route.matched.length || (authState.profileLoading && !authState.registering) || ($route.meta.requiresAuth && !authState.user)" class="flex min-h-dvh items-center justify-center p-6">
    <p role="status" class="text-sm text-stone-600">Loading account…</p>
  </main>
  <RouterView v-else />
</template>
