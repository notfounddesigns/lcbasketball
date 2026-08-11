<script setup lang="ts">
import AppNav from '@/components/AppNav.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { useAuth } from '@/composables/useAuth'

const { isAuthenticated } = useAuth()
</script>

<template>
  <main class="mx-auto max-w-screen-xl px-4 pb-16">
    <RouterView />
  </main>
  <!-- The tab bar navigates to gated routes, so it stays hidden on the login screen. -->
  <AppNav v-if="isAuthenticated" />
  <ConfirmDialog />
</template>
