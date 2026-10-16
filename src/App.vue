<script setup lang="ts">
import AppNav from '@/components/AppNav.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import ToastHost from '@/components/ToastHost.vue'
import { useAuth } from '@/composables/useAuth'
import { useSupabaseHealth, healthMessage } from '@/composables/useSupabaseHealth'
import { computed, onMounted } from 'vue'

const { isAuthenticated } = useAuth()
const isDev = computed(() => import.meta.env.DEV)
</script>

<template>
  <main class="h-[calc(100dvh-62px)] mx-auto max-w-screen-xl px-4 pb-16 pt-4">
    <RouterView />
  </main>
  <!-- The tab bar navigates to gated routes, so it stays hidden on the login screen. -->
  <AppNav v-if="isAuthenticated || isDev" />
  <ConfirmDialog />
  <ToastHost />
</template>
