import { computed, ref } from 'vue'
import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js'
import { AUTH_STORAGE_KEY, supabase, isSupabaseConfigured } from '@/lib/supabase'

// Module-level singletons — the session is process-wide state, so the router
// guard, the nav and every view read the same refs.
const session = ref<Session | null>(null)
const user = computed(() => session.value?.user ?? null)
const isAuthenticated = computed(() => Boolean(session.value))

export interface AuthResult {
  error: string | null
  /** Sign-up succeeded but Supabase is holding the account for email confirmation. */
  needsConfirmation?: boolean
}

let initPromise: Promise<void> | null = null

/**
 * Restore any persisted session and keep it in sync from then on. Idempotent:
 * the router guard awaits this on every navigation, but the work happens once.
 */
export function initAuth(): Promise<void> {
  if (initPromise) return initPromise

  initPromise = (async () => {
    // Registered before the first read so nothing that happens during it is
    // missed. Also covers token refreshes and sign-outs from another tab.
    supabase.auth.onAuthStateChange((_event, next) => {
      session.value = next
    })
    const { data } = await supabase.auth.getSession()
    session.value = data.session
  })()

  return initPromise
}

export function useAuth() {
  async function signIn(email: string, password: string): Promise<AuthResult> {
    if (!isSupabaseConfigured) return { error: 'Supabase not configured — see README.' }
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (error && isAuthRetryableFetchError(error)) {
    }
    return { error: error?.message ?? null }
  }

  async function signUp(email: string, password: string): Promise<AuthResult> {
    if (!isSupabaseConfigured) return { error: 'Supabase not configured — see README.' }
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    })
    if (error) return { error: error.message }
    // With "Confirm email" on (the Supabase default) sign-up returns a user but
    // no session — the account is unusable until the emailed link is clicked.
    return { error: null, needsConfirmation: !data.session }
  }

  async function signOut(): Promise<AuthResult> {
    const { error } = await supabase.auth.signOut()
    session.value = null

    // A sign-out that fails on the network — offline at the gym, server
    // unreachable — returns early inside supabase-js *without* clearing the
    // persisted session, so a reload would sign the user straight back in.
    // Drop it ourselves: this device is signed out either way. The refresh
    // token stays valid server-side until it expires, which is the honest
    // trade for being able to sign out with no connection.
    if (error) {
      try {
        localStorage.removeItem(AUTH_STORAGE_KEY)
      } catch {
        // Safari private mode can throw on storage access; the in-memory
        // clear above still gets the user back to the login screen.
      }
    }

    return { error: null }
  }

  return { session, user, isAuthenticated, signIn, signUp, signOut }
}
