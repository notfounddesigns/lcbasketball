<script setup lang="ts">
import { ref } from 'vue'
import { useConfirm } from '@/composables/useConfirm'
import { useDialog } from '@/composables/useDialog'

const { confirmState, respond } = useConfirm()

const dialogEl = ref<HTMLElement | null>(null)
useDialog(dialogEl, () => respond(false))
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
        ref="dialogEl"
        role="alertdialog"
        aria-modal="true"
        :aria-labelledby="confirmState.title ? 'confirm-title' : undefined"
        :aria-label="confirmState.title ? undefined : 'Confirm'"
        aria-describedby="confirm-message"
      >
        <div class="rounded-2xl border border-ink-700 bg-ink-900 p-5 shadow-2xl">
          <h2 v-if="confirmState.title" id="confirm-title" class="font-stencil mb-2 text-lg font-bold">
            {{ confirmState.title }}
          </h2>
          <p id="confirm-message" class="text-sm text-ink-500">{{ confirmState.message }}</p>

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
