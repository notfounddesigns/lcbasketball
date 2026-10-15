import { computed, ref } from 'vue'
import { isSupabaseConfigured } from '@/lib/supabase'

/**
 * - `ok`          — the API answered normally.
 * - `paused`      — the server answered, but not as the API (see below).
 * - `unreachable` — nothing answered: offline, DNS, or a blocker on this device.
 * - `unknown`     — not checked yet, or Supabase isn't configured.
 */
export type SupabaseStatus = 'unknown' | 'checking' | 'ok' | 'paused' | 'unreachable'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

const TIMEOUT_MS = 8000

// Module-level so App.vue and the login screen share one result.
const status = ref<SupabaseStatus>('unknown')
let inflight: Promise<SupabaseStatus> | null = null

function withTimeout(init: RequestInit = {}): RequestInit {
  return { ...init, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) }
}

/**
 * A paused free-tier project doesn't fail like a normal API error: the
 * gateway answers with a "project paused" page (HTTP 540) that carries no
 * CORS headers, so the browser hides it and fetch() just throws — Safari's
 * "Load failed", Chrome's "Failed to fetch". That is indistinguishable from
 * being offline, so we probe twice:
 *
 *  1. A normal CORS request to the auth health endpoint. If it reads back,
 *     the project is up (or we can see the 540 directly).
 *  2. If that throws, a `no-cors` request to the same URL. That one succeeds
 *     with an opaque response whenever *anything* answers, so success here
 *     means the host is reachable but isn't serving the API — paused (or
 *     mid-restore). Failure means the network itself is the problem.
 */
async function probe(): Promise<SupabaseStatus> {
  if (!isSupabaseConfigured || !url || !anonKey) return 'unknown'
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'unreachable'

  const healthUrl = `${url.replace(/\/+$/, '')}/auth/v1/health`

  try {
    const res = await fetch(healthUrl, withTimeout({ headers: { apikey: anonKey } }))
    if (res.status === 540) return 'paused'
    // Any other readable response — even a 4xx/5xx — proves the API is
    // serving; a real error there will surface through the normal call path.
    return 'ok'
  } catch {
    // Fall through to the opaque probe.
  }

  try {
    await fetch(healthUrl, withTimeout({ mode: 'no-cors' }))
    return 'paused'
  } catch {
    return 'unreachable'
  }
}

/** Run the probe. Concurrent callers share one request. */
export function checkSupabaseHealth(): Promise<SupabaseStatus> {
  if (inflight) return inflight
  status.value = 'checking'
  inflight = probe().then((result) => {
    status.value = result
    inflight = null
    return result
  })
  return inflight
}

export function useSupabaseHealth() {
  const isDown = computed(() => status.value === 'paused' || status.value === 'unreachable')
  return { status, isDown, check: checkSupabaseHealth }
}

/** User-facing copy for a failed status, or null when there's nothing to say. */
export function healthMessage(s: SupabaseStatus): string | null {
  if (s === 'paused') {
    return 'The database is paused. Restore the project in the Supabase dashboard, wait a few minutes, then reload.'
  }
  if (s === 'unreachable') {
    return "Can't reach the server. Check your internet connection, or try another network."
  }
  return null
}
