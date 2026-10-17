<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/composables/useAuth'

// Reached from an invite or password-reset email (see main.ts): the link has
// already signed the user in, so all that's left is choosing a password.
const router = useRouter()
const { user } = useAuth()

const password = ref('')
const confirmPassword = ref('')
const busy = ref(false)
const error = ref<string | null>(null)

const problem = computed(() => {
  if (password.value.length < 8) return 'Use at least 8 characters.'
  if (password.value !== confirmPassword.value) return "The passwords don't match."
  return null
})

async function submit() {
  if (busy.value) return
  if (problem.value) {
    error.value = problem.value
    return
  }
  busy.value = true
  error.value = null
  const { error: err } = await supabase.auth.updateUser({ password: password.value })
  busy.value = false
  if (err) {
    error.value = err.message
    return
  }
  await router.replace('/')
}
</script>

<template>
  <div class="flex h-[100dvh] flex-col items-center justify-center overflow-y-auto py-10">
    <div class="w-full max-w-sm">
      <header class="mb-3 text-center">
        <img src="/LCLogo-Alt.png" alt="LC Basketball" class="mx-auto mb-3 w-48" />
        <h1 class="font-stencil text-xl font-bold">Choose your password</h1>
        <p v-if="user?.email" class="mt-1 text-sm text-ink-500">{{ user.email }}</p>
      </header>
      <form class="card p-5" novalidate @submit.prevent="submit">
        <div class="mb-4">
          <label class="label" for="new-password">New password</label>
          <input id="new-password" v-model="password" class="input" type="password" autocomplete="new-password" :disabled="busy" />
        </div>
        <div class="mb-5">
          <label class="label" for="confirm-password">Confirm password</label>
          <input id="confirm-password" v-model="confirmPassword" class="input" type="password" autocomplete="new-password" :disabled="busy" />
        </div>
        <p v-if="error" class="mb-4 text-sm text-red-400" role="alert">{{ error }}</p>
        <button class="btn-primary w-full" type="submit" :disabled="busy">
          {{ busy ? 'Saving…' : 'Save password' }}
        </button>
      </form>
    </div>
  </div>
</template>
