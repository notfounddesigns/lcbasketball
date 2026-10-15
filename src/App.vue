<script setup lang="ts">
import AppNav from '@/components/AppNav.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { useAuth } from '@/composables/useAuth'
import { useSupabaseHealth, healthMessage } from '@/composables/useSupabaseHealth'
import { computed, onMounted } from 'vue'

const { isAuthenticated } = useAuth()
const isDev = computed(() => import.meta.env.DEV)

// Check once on load so a paused project shows up before anyone tries to sign
// in, rather than as a cryptic "Load failed" afterwards.
const { status: dbStatus, check: checkDb } = useSupabaseHealth()
const dbMessage = computed(() => healthMessage(dbStatus.value))
onMounted(checkDb)
</script>

<template>
  <div
    v-if="dbMessage"
    class="fixed inset-x-0 top-0 z-40 flex items-center justify-center gap-3 border-b border-rim/30 bg-ink-900/95 px-4 py-2 text-center text-xs text-rim backdrop-blur-xl"
    style="padding-top: max(0.5rem, env(safe-area-inset-top, 0px))"
    role="alert"
  >
    <span>{{ dbMessage }}</span>
    <button class="shrink-0 font-semibold underline" @click="checkDb">
      Retry
    </button>
  </div>
  <main class="h-[calc(100dvh-62px)] mx-auto max-w-screen-xl px-4 pb-16 pt-4">
    <RouterView />
  </main>
  <!-- The tab bar navigates to gated routes, so it stays hidden on the login screen. -->
  <AppNav v-if="isAuthenticated || isDev" />
  <ConfirmDialog />
</template>
