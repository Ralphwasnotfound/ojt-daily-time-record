import { adminKey, adminApi, adminError } from './supabaseAdmin.js'
export default {
  data() { return { result: null, loading: false, error: '', requestVersion: 0 } },
  computed: { identity() { return adminKey() } },
  watch: { identity() { this.refresh() }, id() { this.refresh() } },
  mounted() { this.refresh(); window.addEventListener('focus', this.refresh) },
  beforeUnmount() { this.requestVersion++; this.result = null; window.removeEventListener('focus', this.refresh) },
  methods: {
    async refresh() {
      const version = ++this.requestVersion, identity = this.identity
      this.result = null; this.error = ''; this.loading = !!identity
      if (!identity) return
      try {
        const result = this.id ? (await adminApi.students({ target_uid: this.id, page_size: 1 }))[0] || null : await adminApi.dashboard()
        if (version === this.requestVersion && identity === this.identity) this.result = result
      } catch { if (version === this.requestVersion && identity === this.identity) this.error = adminError() }
      finally { if (version === this.requestVersion) this.loading = false }
    },
  },
}
