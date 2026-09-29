import { createClient } from '@supabase/supabase-js'
import { browserConfig } from './config.js'

let client = null
let configurationError = ''
try {
  const { url, key } = browserConfig(import.meta.env)
  client = createClient(url, key, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
} catch (error) {
  // Show configuration failures without logging any credential values.
  configurationError = error.message
}
export const supabase = client
export const supabaseConfigurationError = configurationError
