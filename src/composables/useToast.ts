import { ref } from 'vue'

export interface Toast {
  id: number
  message: string
  tone: 'success' | 'error'
}

// Module-level singleton so every caller and the single <ToastHost /> share
// the same queue.
const toasts = ref<Toast[]>([])
let seq = 0

export function useToast() {
  /** Show a short confirmation that disappears on its own. */
  function toast(message: string, tone: Toast['tone'] = 'success', ms = 2200) {
    const id = ++seq
    toasts.value = [...toasts.value, { id, message, tone }]
    setTimeout(() => dismiss(id), ms)
  }

  function dismiss(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  return { toasts, toast, dismiss }
}
