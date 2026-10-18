<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'

// Floating speed dial for the court editor. The main button sits in the
// court's bottom-right corner; opening it fans the drawing tools out upward and
// the whole-phase actions out to the left, so neither run gets long enough to
// leave a short court on a phone.
type DialTool = 'pen' | 'marker' | 'text' | 'erase'

const props = defineProps<{ active: string; canUndo: boolean }>()
const emit = defineEmits<{ toggle: [DialTool]; undo: []; clear: []; export: [] }>()

const TOOLS: { tool: DialTool; icon: string; label: string }[] = [
  { tool: 'pen', icon: 'fa-solid fa-pen', label: 'Draw' },
  { tool: 'marker', icon: 'fa-solid fa-user-plus', label: 'Add player' },
  { tool: 'text', icon: 'fa-solid fa-comment-dots', label: 'Add text' },
  { tool: 'erase', icon: 'fa-solid fa-eraser', label: 'Eraser' },
]

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)

// Closed, the main button shows the active tool so it's clear what a drag
// on the court will do.
const activeTool = computed(() => TOOLS.find((t) => t.tool === props.active) ?? null)
const fabIcon = computed(() => (open.value ? 'fa-solid fa-xmark' : activeTool.value?.icon ?? 'fa-solid fa-pen-ruler'))

function pickTool(t: DialTool) {
  emit('toggle', t)
  open.value = false
}

// Undo leaves the dial open so several steps can be taken back in a row.
function act(action: 'clear' | 'export') {
  open.value = false
  if (action === 'clear') emit('clear')
  else emit('export')
}

// A tap anywhere outside the dial, or Escape, folds it back up.
function onDocPointerDown(e: PointerEvent) {
  if (rootRef.value && !rootRef.value.contains(e.target as Node)) open.value = false
}
function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}

watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener('pointerdown', onDocPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
  } else {
    document.removeEventListener('pointerdown', onDocPointerDown, true)
    document.removeEventListener('keydown', onKeyDown)
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  document.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <div ref="rootRef" class="absolute bottom-10 right-3 z-20" @pointerdown.stop>
    <!-- drawing tools: fan out above the main button -->
    <div
      class="absolute bottom-full right-[3px] mb-2 flex flex-col-reverse gap-2 transition duration-150"
      :class="open ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0'"
      role="menu"
      aria-label="Drawing tools"
    >
      <button
        v-for="t in TOOLS"
        :key="t.tool"
        class="tb-btn shadow-lg"
        :class="{ 'tb-on': active === t.tool }"
        :title="t.label"
        :aria-label="t.label"
        :aria-pressed="active === t.tool"
        :tabindex="open ? 0 : -1"
        role="menuitemcheckbox"
        @click="pickTool(t.tool)"
      >
        <font-awesome-icon :icon="t.icon" class="h-5 w-5" />
      </button>
    </div>

    <!-- phase actions: fan out to the left of the main button -->
    <div
      class="absolute right-full top-[3px] mr-2 flex flex-row-reverse gap-2 transition duration-150"
      :class="open ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-2 opacity-0'"
      role="menu"
      aria-label="Phase actions"
    >
      <button class="tb-btn shadow-lg" title="Undo" aria-label="Undo" :disabled="!canUndo" :tabindex="open ? 0 : -1" role="menuitem" @click="emit('undo')">
        <font-awesome-icon icon="fa-solid fa-rotate-left" class="h-5 w-5" />
      </button>
      <button class="tb-btn shadow-lg" title="Clear phase" aria-label="Clear phase" :tabindex="open ? 0 : -1" role="menuitem" @click="act('clear')">
        <font-awesome-icon icon="fa-solid fa-trash-can" class="h-5 w-5" />
      </button>
      <button class="tb-btn shadow-lg" title="Export PNG" aria-label="Export PNG" :tabindex="open ? 0 : -1" role="menuitem" @click="act('export')">
        <font-awesome-icon icon="fa-solid fa-download" class="h-5 w-5" />
      </button>
    </div>

    <!-- main button -->
    <button
      class="flex h-11 w-11 items-center justify-center rounded-full border shadow-xl transition"
      :class="activeTool && !open
        ? 'border-rim bg-rim text-white'
        : 'border-ink-600 bg-ink-800 text-chalk hover:bg-ink-700 active:bg-ink-600'"
      :title="open ? 'Close tools' : activeTool ? `Tools (${activeTool.label})` : 'Tools'"
      :aria-label="open ? 'Close tools' : 'Open tools'"
      :aria-expanded="open"
      aria-haspopup="menu"
      @click="open = !open"
    >
      <font-awesome-icon :icon="fabIcon" class="h-5 w-5" />
    </button>
  </div>
</template>
