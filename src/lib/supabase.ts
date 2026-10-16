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

// Clips live in a private bucket, so playback needs a short-lived signed URL.
// Long enough to cover a practice or a game; a refetch issues fresh ones.
const SIGNED_URL_TTL_S = 60 * 60 * 12

/** Attach a signed playback URL to each clip (one request for the whole batch). */
export async function withSignedUrls<T extends { storage_path: string }>(
  videos: T[],
): Promise<(T & { url: string | null })[]> {
  if (!isSupabaseConfigured || !videos.length) return videos.map((v) => ({ ...v, url: null }))
  const { data } = await supabase.storage
    .from(VIDEO_BUCKET)
    .createSignedUrls(videos.map((v) => v.storage_path), SIGNED_URL_TTL_S)
  const byPath = new Map((data ?? []).map((d) => [d.path, d.signedUrl]))
  return videos.map((v) => ({ ...v, url: byPath.get(v.storage_path) ?? null }))
}
