<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import { useConfirm } from '@/composables/useConfirm'

const router = useRouter()
const { user, signOut } = useAuth()
const { confirm } = useConfirm()

const busy = ref(false)

function formatDate(value: string | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

async function handleSignOut() {
  const ok = await confirm({
    title: 'Sign out?',
    message: "You'll need your email and password to get back in.",
    confirmText: 'Sign out',
  })
  if (!ok) return

  // signOut always clears this device, so there is no failure branch to show.
  busy.value = true
  await signOut()
  busy.value = false
  await router.replace({ name: 'login' })
}
</script>

<template>
  <div class="pt-6 pb-nav mx-auto mt-24 md:mt-32 lg:mt-40 text-center md:w-2/3 lg:w-1/2 h-1/2">
    <h1 class="font-stencil mb-5 text-3xl font-bold uppercase tracking-wide text-chalk">
      Account
    </h1>

    <div class="flex flex-col card max-w-md mx-auto gap-2 !bg-transparent !border-none">
      <div class="p-4 rounded-lg bg-ink-700/60">
        <p class="label">Signed in as</p>
        <p class="break-all text-sm text-chalk">{{ user?.email ?? '—' }}</p>
      </div>
      <div class="p-4 rounded-lg bg-ink-700/60">
        <p class="label">Last sign in</p>
        <p class="text-sm text-chalk">{{ formatDate(user?.last_sign_in_at) }}</p>
      </div>
    </div>

    <button class="btn-danger mt-5 w-full max-w-md" :disabled="busy" @click="handleSignOut">
      {{ busy ? 'Signing out…' : 'Sign out' }}
    </button>
  </div>
</template>
