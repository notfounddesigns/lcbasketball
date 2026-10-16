<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import { isSupabaseConfigured } from '@/lib/supabase'

const route = useRoute()
const router = useRouter()
const { signIn, signOut, checkStaff } = useAuth()

const email = ref('')
const password = ref('')

const busy = ref(false)
const error = ref<string | null>(null)

// Clear a stale failure as soon as the user starts fixing it.
watch([email, password], () => {
  error.value = null
})

function validate(): string | null {
  if (!email.value.trim()) return 'Enter your email address.'
  if (!password.value) return 'Enter your password.'
  return null
}

// Accounts are created by the head coach (see the staff migration in
// supabase/schema.sql), so there's no self-service sign-up here.
async function submit() {
  if (busy.value) return

  const invalid = validate()
  if (invalid) {
    error.value = invalid
    return
  }

  busy.value = true
  error.value = null

  const result = await signIn(email.value, password.value)
  if (result.error) {
    busy.value = false
    error.value = result.error
    return
  }

  // A valid login that isn't on the staff list would see an empty app (RLS
  // returns no rows), so say why and sign straight back out.
  if (!(await checkStaff())) {
    await signOut()
    busy.value = false
    error.value = "This account isn't on the coaching staff list. Ask the head coach to add you."
    return
  }

  busy.value = false

  // The guard stashes where the user was headed before it bounced them here.
  // Only in-app paths are honoured — '//host' and absolute URLs are dropped so
  // a crafted link can't turn the login screen into an open redirect.
  const redirect = route.query.redirect
  const target =
    typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//')
      ? redirect
      : '/'
  await router.replace(target)
}
</script>

<template>
  <div class="flex h-[100dvh] flex-col items-center justify-center py-10 overflow-y-auto">
    <div class="w-full max-w-sm">
      <header class="mb-3 text-center">
        <img src="/LCLogo-Alt.png" alt="LC Basketball" class="mx-auto mb-3 w-48" />
      </header>

      <div
        v-if="!isSupabaseConfigured"
        class="card mb-4 border-rim/30 bg-rim/10 p-3 text-xs text-rim"
      >
        Supabase is not configured. Set <span class="font-mono">VITE_SUPABASE_URL</span> and
        <span class="font-mono">VITE_SUPABASE_ANON_KEY</span> in
        <span class="font-mono">.env.local</span> — see the README.
      </div>

      <form class="card p-5" novalidate @submit.prevent="submit">
        <div class="mb-4">
          <label class="label" for="email">Email</label>
          <input
            id="email"
            v-model="email"
            class="input"
            type="email"
            autocomplete="email"
            autocapitalize="none"
            autocorrect="off"
            placeholder="coach@example.com"
            :disabled="busy"
          />
        </div>

        <div class="mb-5">
          <label class="label" for="password">Password</label>
          <input
            id="password"
            v-model="password"
            class="input"
            type="password"
            autocomplete="current-password"
            placeholder="••••••••"
            :disabled="busy"
          />
        </div>

        <p v-if="error" class="mb-4 text-sm text-red-400" role="alert">{{ error }}</p>

        <button class="btn-primary w-full" type="submit" :disabled="busy">
          {{ busy ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>

      <p class="mt-5 text-center text-sm text-ink-500">
        Need an account? Ask the head coach to add you.
      </p>
    </div>
  </div>
</template>
