<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import { isSupabaseConfigured } from '@/lib/supabase'

const route = useRoute()
const router = useRouter()
const { signIn, signUp } = useAuth()

type Mode = 'signin' | 'signup'
const mode = ref<Mode>('signin')

const email = ref('')
const password = ref('')
const confirmPassword = ref('')

const busy = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)

const isSignUp = computed(() => mode.value === 'signup')

// Supabase rejects anything under 6 by default; 8 is the cheapest upgrade over
// a password protecting a whole team's roster.
const MIN_PASSWORD = 8

function switchMode(next: Mode) {
  mode.value = next
  error.value = null
  notice.value = null
  confirmPassword.value = ''
}

// Clear a stale failure as soon as the user starts fixing it.
watch([email, password, confirmPassword], () => {
  error.value = null
})

function validate(): string | null {
  if (!email.value.trim()) return 'Enter your email address.'
  if (!password.value) return 'Enter your password.'
  if (isSignUp.value) {
    if (password.value.length < MIN_PASSWORD) {
      return `Password must be at least ${MIN_PASSWORD} characters.`
    }
    if (password.value !== confirmPassword.value) return 'Passwords do not match.'
  }
  return null
}

async function submit() {
  if (busy.value) return

  const invalid = validate()
  if (invalid) {
    error.value = invalid
    return
  }

  busy.value = true
  error.value = null
  notice.value = null

  const result = isSignUp.value
    ? await signUp(email.value, password.value)
    : await signIn(email.value, password.value)

  busy.value = false

  if (result.error) {
    error.value = result.error
    return
  }

  if (result.needsConfirmation) {
    notice.value = `Check ${email.value.trim()} for a confirmation link, then sign in.`
    switchMode('signin')
    password.value = ''
    return
  }

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
  <div class="flex min-h-[100dvh] flex-col items-center justify-center py-10">
    <div class="w-full max-w-sm">
      <header class="mb-8 text-center">
        <img src="/LCLogo-Alt.png" alt="LC Basketball" class="mx-auto mb-3 w-56" />
        <p class="mt-1 text-sm text-ink-500">
          {{ isSignUp ? 'Create a coaching account' : '' }}
        </p>
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

        <div :class="isSignUp ? 'mb-4' : 'mb-5'">
          <label class="label" for="password">Password</label>
          <input
            id="password"
            v-model="password"
            class="input"
            type="password"
            :autocomplete="isSignUp ? 'new-password' : 'current-password'"
            placeholder="••••••••"
            :disabled="busy"
          />
        </div>

        <div v-if="isSignUp" class="mb-5">
          <label class="label" for="confirm-password">Confirm password</label>
          <input
            id="confirm-password"
            v-model="confirmPassword"
            class="input"
            type="password"
            autocomplete="new-password"
            placeholder="••••••••"
            :disabled="busy"
          />
        </div>

        <p v-if="error" class="mb-4 text-sm text-red-400" role="alert">{{ error }}</p>
        <p v-else-if="notice" class="mb-4 text-sm text-home" role="status">{{ notice }}</p>

        <button class="btn-primary w-full" type="submit" :disabled="busy">
          {{ busy ? 'Working…' : isSignUp ? 'Create account' : 'Sign in' }}
        </button>
      </form>

      <p class="mt-5 text-center text-sm text-ink-500">
        <template v-if="isSignUp">
          Already have an account?
          <button class="font-semibold text-rim hover:brightness-110" @click="switchMode('signin')">
            Sign in
          </button>
        </template>
        <template v-else>
          Need an account?
          <button class="font-semibold text-rim hover:brightness-110" @click="switchMode('signup')">
            Sign up
          </button>
        </template>
      </p>
    </div>
  </div>
</template>
