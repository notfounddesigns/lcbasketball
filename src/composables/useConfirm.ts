import { reactive } from 'vue'

export interface ConfirmOptions {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  tone?: 'default' | 'danger'
}

interface ConfirmState extends Required<ConfirmOptions> {
  open: boolean
  resolve: ((value: boolean) => void) | null
}

// Module-level singleton so every caller and the single <ConfirmDialog />
// instance share the same reactive state.
const state = reactive<ConfirmState>({
  open: false,
  title: '',
  message: '',
  confirmText: 'Confirm',
  cancelText: 'Cancel',
  tone: 'default',
  resolve: null,
})

export function useConfirm() {
  /**
   * Show the global confirmation dialog and resolve to the user's choice.
   * Pass a plain string for a simple message, or an options object to
   * customise the title, button labels, and tone.
   */
  function confirm(options: ConfirmOptions | string): Promise<boolean> {
    const opts = typeof options === 'string' ? { message: options } : options

    // If a previous prompt is still pending, dismiss it as cancelled.
    state.resolve?.(false)

    state.title = opts.title ?? ''
    state.message = opts.message
    state.confirmText = opts.confirmText ?? 'Confirm'
    state.cancelText = opts.cancelText ?? 'Cancel'
    state.tone = opts.tone ?? 'default'
    state.open = true

    return new Promise<boolean>((resolve) => {
      state.resolve = resolve
    })
  }

  function respond(value: boolean) {
    state.open = false
    state.resolve?.(value)
    state.resolve = null
  }

  return { confirmState: state, confirm, respond }
}
