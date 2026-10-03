import { createClient } from 'npm:@supabase/supabase-js@2.117.2'
import { createLocationHandler, createProofAuthorizer } from './core.js'

// Caller JWT and anon key only. No service-role access and no request/address logs.
const origins = (Deno.env.get('ATTENDANCE_LOCATION_ALLOWED_ORIGINS') || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(value => value.trim()).filter(Boolean)
let windowStart = 0, calls = 0
Deno.serve(createLocationHandler({
  apiKey: Deno.env.get('GEOAPIFY_API_KEY'), allowedOrigins: origins,
  // Conservative per-worker burst guard; not a distributed/global quota guarantee.
  allowLookup() { const now = Date.now(); if (now - windowStart >= 1000) { windowStart = now; calls = 0 } return ++calls <= 4 },
  authorize: createProofAuthorizer(createClient, Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!),
}))
