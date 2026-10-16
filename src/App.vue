<script setup lang="ts">
import AppNav from '@/components/AppNav.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import ToastHost from '@/components/ToastHost.vue'
import { useAuth } from '@/composables/useAuth'
import { useSupabaseHealth, healthMessage } from '@/composables/useSupabaseHealth'
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const { isAuthenticated } = useAuth()
const isDev = computed(() => import.meta.env.DEV)
const route = useRoute()
const router = useRouter()

// A paused free-tier project or a dead connection otherwise surfaces as a raw
// "Failed to fetch" deep inside a view; check up front and say what's wrong.
const { status, check } = useSupabaseHealth()
const healthNotice = computed(() => healthMessage(status.value))
const recheck = () => check()
onMounted(() => {
  check()
  window.addEventListener('online', recheck)
})
onBeforeUnmount(() => window.removeEventListener('online', recheck))

// The session can end underneath an open view — a failed token refresh, or a
// sign-out in another tab. Send the coach back to the login screen rather than
// leaving every request silently failing.
watch(isAuthenticated, (now, was) => {
  if (was && !now && !isDev.value && !route.meta.public) {
    router.replace({ name: 'login', query: { redirect: route.fullPath } })
  }
})
</script>

<template>
  <div
    v-if="healthNotice"
    class="fixed inset-x-0 top-0 z-[65] flex items-center gap-3 border-b border-rim/40 bg-ink-900/95 px-4 py-2 text-sm text-red-300 backdrop-blur"
    role="alert"
  >
    <span class="grow">{{ healthNotice }}</span>
    <button class="btn-ghost shrink-0 py-1 text-xs" :disabled="status === 'checking'" @click="recheck">
      {{ status === 'checking' ? 'Checking…' : 'Retry' }}
    </button>
  </div>
  <main class="h-[calc(100dvh-62px)] mx-auto max-w-screen-xl px-4 pb-16 pt-4">
    <RouterView />
  </main>
  <!-- The tab bar navigates to gated routes, so it stays hidden on the login screen. -->
  <AppNav v-if="isAuthenticated || isDev" />
  <ConfirmDialog />
  <ToastHost />
</template>
