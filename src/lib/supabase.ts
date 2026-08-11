import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && anonKey)

if (!isSupabaseConfigured) {
  // Surface a clear, actionable message instead of a cryptic network failure.
  console.warn(
    '[playbook] Supabase is not configured. Copy .env.example to .env.local ' +
      'and set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  )
}

// Pinned rather than left to supabase-js's URL-derived default so useAuth can
// clear the persisted session itself when signOut() fails — see useAuth.
export const AUTH_STORAGE_KEY = 'lcbb-auth-token'

// Created even when unconfigured so imports never crash; calls will simply
// fail until env vars are provided. Components check isSupabaseConfigured.
export const supabase: SupabaseClient = createClient(
  url ?? 'http://localhost:54321',
  anonKey ?? 'public-anon-key-placeholder',
  { auth: { storageKey: AUTH_STORAGE_KEY } },
)

export const VIDEO_BUCKET = 'play-videos'
