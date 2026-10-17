import { nextTick, onBeforeUnmount, watch, type Ref } from 'vue'

// Open dialogs, innermost last. Escape and the Tab trap only act on the top
// one, so a confirm raised over the practice-plan modal closes on its own.
const stack: HTMLElement[] = []

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', 'video[controls]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  )
}

function onKeydown(e: KeyboardEvent) {
  const top = stack[stack.length - 1]
  if (!top) return
  if (e.key === 'Escape') {
    e.preventDefault()
    top.dispatchEvent(new CustomEvent('dialog-escape'))
    return
  }
  if (e.key !== 'Tab') return
  const items = focusables(top)
  if (!items.length) {
    e.preventDefault()
    top.focus()
    return
  }
  const first = items[0]
  const last = items[items.length - 1]
  const active = document.activeElement as HTMLElement | null
  if (e.shiftKey && (active === first || !top.contains(active))) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && (active === last || !top.contains(active))) {
    e.preventDefault()
    first.focus()
  }
}

/**
 * Modal dialog behaviour for whatever element `el` points at: while it is
 * mounted, Escape calls `onEscape`, Tab stays inside it, focus moves in
 * (to an `[autofocus]` element, else the first control) and goes back to
 * whatever had it when the dialog closes. Works with `v-if` dialogs too —
 * it follows the ref as it appears and disappears.
 */
export function useDialog(el: Ref<HTMLElement | null>, onEscape: () => void) {
  let opener: HTMLElement | null = null
  const escape = () => onEscape()

  function open(node: HTMLElement) {
    opener = document.activeElement as HTMLElement | null
    if (!stack.length) document.addEventListener('keydown', onKeydown)
    stack.push(node)
    node.addEventListener('dialog-escape', escape)
    if (!node.hasAttribute('tabindex')) node.tabIndex = -1
    nextTick(() => {
      const target = node.querySelector<HTMLElement>('[autofocus]') ?? focusables(node)[0] ?? node
      target.focus({ preventScroll: true })
    })
  }

  function close(node: HTMLElement) {
    node.removeEventListener('dialog-escape', escape)
    const i = stack.indexOf(node)
    if (i !== -1) stack.splice(i, 1)
    if (!stack.length) document.removeEventListener('keydown', onKeydown)
    if (opener?.isConnected) opener.focus({ preventScroll: true })
    opener = null
  }

  watch(el, (node, prev) => {
    if (prev) close(prev)
    if (node) open(node)
  }, { immediate: true, flush: 'post' })

  onBeforeUnmount(() => {
    if (el.value) close(el.value)
  })
}
