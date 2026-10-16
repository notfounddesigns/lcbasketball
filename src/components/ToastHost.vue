<script setup lang="ts">
import { CheckCircleIcon, ExclamationCircleIcon } from '@heroicons/vue/24/solid'
import { useToast } from '@/composables/useToast'

const { toasts, dismiss } = useToast()
</script>

<template>
  <Teleport to="body">
    <!-- Sits above the bottom tab bar; pointer events only on the toasts themselves -->
    <div
      class="pointer-events-none fixed inset-x-0 bottom-20 z-[70] flex flex-col items-center gap-2 px-4"
      aria-live="polite"
    >
      <TransitionGroup
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="translate-y-3 opacity-0"
        leave-active-class="transition duration-150 ease-in"
        leave-to-class="opacity-0"
      >
        <button
          v-for="t in toasts"
          :key="t.id"
          class="pointer-events-auto flex items-center gap-2 rounded-full border border-ink-700 bg-ink-800/95 px-4 py-2 text-sm font-medium text-chalk shadow-xl backdrop-blur"
          @click="dismiss(t.id)"
        >
          <CheckCircleIcon v-if="t.tone === 'success'" class="h-5 w-5 text-green-400" />
          <ExclamationCircleIcon v-else class="h-5 w-5 text-rim" />
          {{ t.message }}
        </button>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
