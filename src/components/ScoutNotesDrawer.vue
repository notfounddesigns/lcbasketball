<script setup lang="ts">
import { onBeforeUnmount, reactive, ref, watch } from 'vue'
import type { Game } from '@/types'
import { useStats } from '@/composables/useStats'
import { XMarkIcon } from '@heroicons/vue/24/outline'

// Scouting notes, typed while watching. Each field saves itself shortly after
// the coach stops typing (and on close), so nothing is lost mid-game.
const props = defineProps<{ game: Game; open: boolean }>()
const emit = defineEmits<{ close: []; saved: [game: Game] }>()

const { updateGame } = useStats()

type NoteKey = 'scout_key_players' | 'scout_offense' | 'scout_defense' | 'notes'

const FIELDS: { key: NoteKey; label: string; placeholder: string; rows: number }[] = [
  { key: 'scout_key_players', label: 'Key players', placeholder: '#23 — left-hand driver, weak off the ball…', rows: 5 },
  { key: 'scout_offense', label: 'Offensive scheme', placeholder: '4-out 1-in, high ball screens, sets out of timeouts…', rows: 4 },
  { key: 'scout_defense', label: 'Defensive scheme', placeholder: '2-3 zone, presses after makes, switches 1–4…', rows: 4 },
  { key: 'notes', label: 'Other notes', placeholder: 'Tempo, bench, coach tendencies…', rows: 3 },
]

const draft = reactive<Record<NoteKey, string>>({ scout_key_players: '', scout_offense: '', scout_defense: '', notes: '' })
const status = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')

function load(g: Game) {
  for (const f of FIELDS) draft[f.key] = (g[f.key] as string | null | undefined) ?? ''
}
watch(() => props.game.id, () => load(props.game), { immediate: true })
// Re-sync when reopened, in case the report was edited elsewhere.
watch(() => props.open, (o) => { if (o) load(props.game) })

function changes() {
  const patch: Partial<Record<NoteKey, string | null>> = {}
  for (const f of FIELDS) {
    const next = draft[f.key].trim() || null
    if (next !== ((props.game[f.key] as string | null | undefined) ?? null)) patch[f.key] = next
  }
  return patch
}

let timer: ReturnType<typeof setTimeout> | undefined
async function save() {
  clearTimeout(timer)
  const patch = changes()
  if (!Object.keys(patch).length) return
  status.value = 'saving'
  const updated = await updateGame(props.game.id, patch)
  status.value = updated ? 'saved' : 'error'
  if (updated) emit('saved', updated)
}

function onInput() {
  status.value = 'idle'
  clearTimeout(timer)
  timer = setTimeout(save, 800)
}

async function close() {
  await save()
  emit('close')
}

onBeforeUnmount(() => { void save() })
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-300 ease-out"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-200 ease-in"
      leave-to-class="opacity-0"
    >
      <div v-if="open" class="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" @click="close" />
    </Transition>
    <Transition
      enter-active-class="transition-transform duration-300 ease-out"
      enter-from-class="translate-x-full"
      leave-active-class="transition-transform duration-200 ease-in"
      leave-to-class="translate-x-full"
    >
      <aside
        v-if="open"
        class="fixed bottom-0 right-0 top-0 z-50 flex w-full max-w-md flex-col border-l border-ink-700 bg-ink-900 shadow-2xl"
        role="dialog" aria-modal="true" aria-labelledby="scout-notes-title"
      >
        <header class="flex items-center gap-2 border-b border-ink-700/60 px-4 py-3">
          <h2 id="scout-notes-title" class="font-stencil text-lg font-bold">Scouting Notes</h2>
          <span class="text-xs" :class="status === 'error' ? 'text-red-400' : 'text-ink-500'">
            {{ status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : status === 'error' ? 'Not saved — check connection' : '' }}
          </span>
          <button class="btn-ghost ml-auto p-1.5" title="Close" aria-label="Close" @click="close"><XMarkIcon class="h-5 w-5" /></button>
        </header>
        <div class="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          <p class="text-xs text-ink-500">{{ game.scouted_team }} vs {{ game.opponent }} · {{ game.played_on }}</p>
          <div v-for="f in FIELDS" :key="f.key">
            <label class="label" :for="`scout-${f.key}`">{{ f.label }}</label>
            <textarea
              :id="`scout-${f.key}`"
              v-model="draft[f.key]"
              :rows="f.rows"
              class="input resize-y"
              :placeholder="f.placeholder"
              @input="onInput"
              @blur="save"
            />
          </div>
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>
