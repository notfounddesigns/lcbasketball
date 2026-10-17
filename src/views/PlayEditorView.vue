<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import type { Diagram, DiagramElement, MarkerElement, PlayDraft } from '@/types'
import { usePlays } from '@/composables/usePlays'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { useStats } from '@/composables/useStats'
import { PLAY_CATEGORIES, resolveCategory } from '@/lib/play-categories'
import CourtCanvas from '@/components/CourtCanvas.vue'
import PlayAnimator from '@/components/PlayAnimator.vue'
import VideoUploader from '@/components/VideoUploader.vue'
import { BackspaceIcon, Bars3BottomLeftIcon, PlusIcon, PrinterIcon, TrashIcon, XMarkIcon } from '@heroicons/vue/24/outline'

const route = useRoute()
const router = useRouter()
const { plays, error: playsError, fetchPlays, createPlay, updatePlay } = usePlays()
const { toast } = useToast()
const { confirm } = useConfirm()
const { players, fetchPlayers } = useStats()
const rosterPlayers = computed(() => players.value.filter((p) => p.active !== false))

// null when on /plays/new; UUID string when on /plays/:id
const playId = computed(() => (route.params.id as string) || null)
const play = computed(() => plays.value.find((p) => p.id === playId.value) ?? null)
const isNew = computed(() => !playId.value)

onMounted(async () => {
  // Support direct navigation to /plays/:id without going through PlaysView
  if (!plays.value.length) await fetchPlays()
  if (!players.value.length) await fetchPlayers()
})

function blankDiagram(): Diagram {
  return { courtType: 'half', elements: [] }
}

const form = reactive<PlayDraft>({
  name: '',
  description: '',
  // "+ New Play" from inside a playbook category passes it along.
  category: resolveCategory(route.query.category as string | undefined) ?? '',
  court_type: 'half',
  diagram: blankDiagram(),
  // "+ Scouting Report" on the Scouting tab opens the editor with this pre-set.
  is_scouting: route.query.scouting === '1',
})

// A play saved under a category that's since been retired keeps that value as an
// extra option, so opening and re-saving it doesn't silently blank the field.
const legacyCategory = computed(() => {
  const c = form.category?.trim()
  return c && !PLAY_CATEGORIES.includes(c as never) ? c : null
})

const saving = ref(false)

const hasCanvasContent = computed(() =>
  form.diagram.elements.length > 0 ||
  (form.diagram.phases?.some((p) => p.length > 0) ?? false),
)

// Play details (name, category, notes, roster, clips) live in a drawer so the
// court gets the whole width. It opens on its own when a new play still needs
// a name.
const showDetails = ref(false)

function openDetails(focusName = false) {
  showDetails.value = true
  if (focusName) nextTick(() => document.getElementById('pe-name')?.focus())
}

function onHeaderButtonClick() {
  if (!form.name.trim()) openDetails(true)
  else save()
}

// Return to the list the coach came from (with its ?category= / ?tab=); on a
// direct visit, open the tab and category this play belongs to.
function goBack() {
  if (window.history.state?.back) {
    router.back()
    return
  }
  // Scouting reports live on the Stats page's Scouting tab.
  if (form.is_scouting) {
    router.push({ path: '/stats', query: { mode: 'scouting' } })
    return
  }
  const category = resolveCategory(form.category)
  router.push({ path: '/plays', query: category ? { category } : {} })
}

// ---------- phase management ----------
const activePhase = ref(0) // 0-indexed; 0 = phase 1

const totalPhases = computed(() => 1 + (form.diagram.phases?.length ?? 0))

// Phase-aware computed binding for CourtCanvas v-model
const phaseDiagram = computed<Diagram>({
  get() {
    const els: DiagramElement[] =
      activePhase.value === 0
        ? form.diagram.elements
        : (form.diagram.phases?.[activePhase.value - 1] ?? [])
    return {
      courtType: form.diagram.courtType,
      elements: els,
      // Pass phases through so CourtCanvas setCourt can detect content in other phases
      phases: form.diagram.phases,
    }
  },
  set(val: Diagram) {
    if (val.courtType !== form.diagram.courtType) {
      // Court type was switched — clear ALL phases and reset
      form.diagram.courtType = val.courtType
      form.diagram.elements = []
      form.diagram.phases = []
      activePhase.value = 0
      return
    }
    if (activePhase.value === 0) {
      form.diagram.elements = val.elements
    } else {
      if (!form.diagram.phases) form.diagram.phases = []
      while (form.diagram.phases.length < activePhase.value) {
        form.diagram.phases.push([])
      }
      form.diagram.phases[activePhase.value - 1] = val.elements
    }
  },
})

function addPhase() {
  if (!form.diagram.phases) form.diagram.phases = []

  // Inherit player markers from the last existing phase so positions carry forward.
  // "Last phase" is always the one immediately before the new one being created,
  // regardless of which phase the user is currently viewing.
  const lastIdx = totalPhases.value - 1 // 0-based index of the current last phase
  const lastElements: DiagramElement[] = lastIdx === 0
    ? form.diagram.elements
    : (form.diagram.phases[lastIdx - 1] ?? [])

  const inheritedMarkers: DiagramElement[] = lastElements
    .filter((el): el is MarkerElement => el.type === 'marker')
    .map((el) => ({ ...el, at: { ...el.at } })) // deep-copy so moves in new phase don't affect previous

  form.diagram.phases.push(inheritedMarkers)
  activePhase.value = form.diagram.phases.length // jump to the new phase
}

function deleteCurrentPhase() {
  if (activePhase.value === 0 || !form.diagram.phases) return
  form.diagram.phases.splice(activePhase.value - 1, 1)
  // Step back onto the previous phase; clamp in case the deleted one was last.
  activePhase.value = Math.min(activePhase.value - 1, totalPhases.value - 1)
}

// Never let the active tab point past the end (e.g. after deleting the last
// phase or loading a play with fewer phases).
watch(totalPhases, (n) => {
  if (activePhase.value > n - 1) activePhase.value = Math.max(0, n - 1)
})

// ---------- animation preview ----------
const animating = ref(false)

// ---------- PNG export ----------
const canvasRef = ref<InstanceType<typeof CourtCanvas> | null>(null)

function exportPng() {
  const phaseSuffix = totalPhases.value > 1 ? ` Phase ${activePhase.value + 1}` : ''
  canvasRef.value?.exportPng(`${form.name || 'play'}${phaseSuffix}.png`)
}

// ---------- unsaved changes ----------
// What the form looked like when it was last loaded or saved; anything else is
// unsaved work. court_type is left out because it mirrors diagram.courtType.
function snapshot(): string {
  const { name, description, category, diagram, is_scouting } = form
  return JSON.stringify({ name, description, category, diagram, is_scouting })
}
const savedSnapshot = ref(snapshot())
const isDirty = computed(() => snapshot() !== savedSnapshot.value)

onBeforeRouteLeave(async () => {
  if (!isDirty.value) return true
  return confirm({
    title: 'Unsaved changes',
    message: 'Leave without saving your changes to this play?',
    confirmText: 'Leave',
    cancelText: 'Keep editing',
    tone: 'danger',
  })
})

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (isDirty.value) e.preventDefault()
}
window.addEventListener('beforeunload', onBeforeUnload)
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))

// Populate the form when a play loads (handles direct-URL navigation). Keyed on
// the id, not the object: saving replaces the store object, and reloading then
// would jump back to phase 1 and drop strokes drawn while the save was in flight.
let loadedId: string | null = null
watch(
  play,
  (p) => {
    if (p && p.id !== loadedId) {
      loadedId = p.id
      form.name = p.name
      form.description = p.description ?? ''
      form.category = p.category ?? ''
      form.court_type = p.court_type
      form.diagram = JSON.parse(JSON.stringify(p.diagram)) as Diagram
      form.is_scouting = p.is_scouting
      activePhase.value = 0 // reset to phase 1 when play changes
      savedSnapshot.value = snapshot()
    }
  },
  { immediate: true },
)

// Keep court_type and diagram.courtType in lockstep
watch(
  () => form.diagram.courtType,
  (ct) => { form.court_type = ct },
)

async function save() {
  if (!form.name.trim()) return
  saving.value = true
  // Taken before the request so edits made while it's in flight stay unsaved.
  const sent = snapshot()
  try {
    if (playId.value) {
      const updated = await updatePlay(playId.value, JSON.parse(JSON.stringify(form)))
      if (updated) {
        savedSnapshot.value = sent
        toast('Play saved')
      }
      else toast(playsError.value ?? 'Could not save play', 'error')
    } else {
      const created = await createPlay(JSON.parse(JSON.stringify(form)))
      if (!created) toast(playsError.value ?? 'Could not create play', 'error')
      if (created) {
        // The form is already the source of this play — don't reload it.
        loadedId = created.id
        savedSnapshot.value = sent
        toast('Play created')
        showDetails.value = false
        // Swap to edit route so the video section becomes available
        await router.replace(`/plays/${created.id}`)
      }
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="flex flex-col gap-4">
    <!-- sticky page header -->
    <div
      class="sticky top-0 z-10 -mx-4 -mt-6 flex items-center gap-3 border-b border-ink-700/60 bg-ink-900/95 px-4 py-3 backdrop-blur-xl"
    >
      <button class="btn-ghost py-1.5 text-sm" title="Back" aria-label="Back" @click="goBack">
        <BackspaceIcon class="h-5 w-5" />
      </button>
      <button
        class="btn-ghost py-1.5 text-sm"
        :class="showDetails ? 'border-rim text-rim' : ''"
        title="Play details" aria-label="Play details" :aria-expanded="showDetails"
        @click="showDetails ? (showDetails = false) : openDetails()"
      >
        <Bars3BottomLeftIcon class="h-5 w-5" />
      </button>
      <h1 class="font-stencil grow truncate text-lg font-bold leading-tight">
        {{ form.name.trim() || (isNew ? 'New play' : 'Edit play') }}
      </h1>
      <button
        v-if="!isNew"
        class="btn-ghost py-1.5 text-sm"
        title="Print play sheet"
        @click="router.push(`/plays/${playId}/print`)">
        <PrinterIcon class="h-5 w-5" />
      </button>
      <button
        class="btn-primary py-1.5 text-sm"
        :disabled="(isNew ? !hasCanvasContent : !form.name.trim()) || saving"
        @click="onHeaderButtonClick"
      >
        {{ saving ? 'Saving…' : isNew ? 'Create' : 'Save' }}
      </button>
    </div>

    <!-- Court fills the width; play details are in the drawer -->
    <div class="min-w-0 pt-3">
        <div class="mb-1.5 flex items-center gap-1">
          <!-- <span class="label mb-0">Diagram</span> -->
          <button
            v-for="i in totalPhases"
            :key="i"
            :class="[
              'shrink-0 rounded px-3 py-1 text-xs font-medium transition',
              activePhase === i - 1
                ? 'bg-rim text-white'
                : 'bg-ink-800 text-ink-400 hover:text-white',
            ]"
            @click="activePhase = i - 1"
          >
            Phase {{ i }}
          </button>
          <button
            class="shrink-0 rounded p-1 text-xs text-ink-500 hover:text-white"
            title="Add phase"
            @click="addPhase"
          >
            <PlusIcon class="h-5 w-5" />
          </button>
          <button
            v-if="totalPhases > 1"
            class="shrink-0 rounded p-1 -ml-2 text-xs text-red-500 hover:text-red-300"
            title="Delete current phase"
            @click="deleteCurrentPhase"
          >
            <TrashIcon class="h-5 w-5" />
          </button>
        </div>

        <CourtCanvas ref="canvasRef" v-model="phaseDiagram" editable :total-phases="totalPhases" @is-animating="animating = $event" @export-png="exportPng" />
    </div>
  </section>

  <!-- Animation preview overlay -->
  <PlayAnimator
    v-if="animating"
    :name="form.name || 'Play'"
    :diagram="form.diagram"
    :videos="play?.videos"
    @close="animating = false"
  />

  <!-- Play details drawer: slides in from the left over the court -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-300 ease-out"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-200 ease-in"
      leave-to-class="opacity-0"
    >
      <div v-if="showDetails" class="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" @click="showDetails = false" />
    </Transition>
    <Transition
      enter-active-class="transition-transform duration-300 ease-out"
      enter-from-class="-translate-x-full"
      leave-active-class="transition-transform duration-200 ease-in"
      leave-to-class="-translate-x-full"
    >
      <aside
        v-if="showDetails"
        class="fixed bottom-0 left-0 top-0 z-50 flex w-80 max-w-[90vw] flex-col gap-3 overflow-y-auto border-r border-ink-700 bg-ink-900 p-4 shadow-2xl"
        aria-label="Play details"
        @keydown.esc="showDetails = false"
      >
        <div class="mb-1 flex items-center justify-between">
          <h2 class="font-stencil text-lg font-bold">Play details</h2>
          <button class="btn-ghost p-1.5" title="Close" aria-label="Close" @click="showDetails = false">
            <XMarkIcon class="h-5 w-5" />
          </button>
        </div>
        <div>
          <label class="label" for="pe-name">Name</label>
          <input id="pe-name" v-model="form.name" class="input" placeholder="Horns flare" @keyup.enter="isNew && form.name.trim() && save()" />
        </div>
        <div>
          <label class="label" for="pe-cat">Category</label>
          <select id="pe-cat" v-model="form.category" class="input">
            <option value="">— No category —</option>
            <option v-for="cat in PLAY_CATEGORIES" :key="cat" :value="cat">{{ cat }}</option>
            <option v-if="legacyCategory" :value="legacyCategory">{{ legacyCategory }} (old)</option>
          </select>
        </div>
        <div>
          <label class="label" for="pe-desc">Notes</label>
          <textarea
            id="pe-desc"
            v-model="form.description"
            rows="4"
            class="input resize-none"
            placeholder="When to call it, reads, counters…"
          />
        </div>

        <label class="flex cursor-pointer items-center gap-2 rounded-lg border border-ink-700 px-3 py-2.5">
          <input type="checkbox" v-model="form.is_scouting" class="h-4 w-4 rounded accent-rim" />
          <span class="text-sm font-medium">Opponent scouting report</span>
        </label>

        <button
          v-if="isNew"
          class="btn-primary py-3 text-sm font-semibold"
          :disabled="!form.name.trim() || saving"
          @click="save"
        >
          {{ saving ? 'Saving…' : 'Create play' }}
        </button>

        <!-- Roster reference -->
        <div v-if="rosterPlayers.length" class="rounded-lg border border-ink-700 p-3">
          <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Roster</p>
          <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <div v-for="pl in rosterPlayers" :key="pl.id" class="flex items-center gap-1.5">
              <span class="w-6 shrink-0 text-right font-mono text-xs text-ink-400">#{{ pl.number ?? '—' }}</span>
              <span class="truncate">{{ pl.name }}</span>
            </div>
          </div>
        </div>

        <!-- video clips (only once the play exists in the DB) -->
        <div v-if="play" class="border-t border-ink-700 pt-3">
          <label class="label">Video clips</label>
          <VideoUploader :play="play" />
        </div>
        <p v-else class="text-xs text-ink-500">Save the play first to attach video clips.</p>
      </aside>
    </Transition>
  </Teleport>

</template>
