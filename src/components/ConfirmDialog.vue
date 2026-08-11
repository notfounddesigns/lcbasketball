<script setup lang="ts">
import { useConfirm } from '@/composables/useConfirm'

const { confirmState, respond } = useConfirm()
</script>

<template>
  <Teleport to="body">
    <!-- Backdrop -->
    <Transition
      enter-active-class="transition-opacity duration-200 ease-out"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-150 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-if="confirmState.open"
        class="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm"
        @click="respond(false)"
      />
    </Transition>

    <!-- Dialog -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 scale-95"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-if="confirmState.open"
        class="fixed inset-x-0 top-1/2 z-[70] mx-auto w-[calc(100%-2rem)] max-w-sm -translate-y-1/2"
        role="dialog"
        aria-modal="true"
        @keydown.esc="respond(false)"
      >
        <div class="rounded-2xl border border-ink-700 bg-ink-900 p-5 shadow-2xl">
          <h2 v-if="confirmState.title" class="font-stencil mb-2 text-lg font-bold">
            {{ confirmState.title }}
          </h2>
          <p class="text-sm text-ink-500">{{ confirmState.message }}</p>

          <div class="mt-5 flex justify-end gap-2">
            <button class="btn-ghost py-2 text-sm" @click="respond(false)">
              {{ confirmState.cancelText }}
            </button>
            <button
              class="py-2 text-sm"
              :class="confirmState.tone === 'danger' ? 'btn-danger' : 'btn-primary'"
              autofocus
              @click="respond(true)"
            >
              {{ confirmState.confirmText }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
