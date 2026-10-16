<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Diagram, DiagramElement, MarkerElement, PlayDraft } from '@/types'
import { usePlays } from '@/composables/usePlays'
import { useToast } from '@/composables/useToast'
import { useStats } from '@/composables/useStats'
import { PLAY_CATEGORIES, resolveCategory } from '@/lib/play-categories'
import CourtCanvas from '@/components/CourtCanvas.vue'
import PlayAnimator from '@/components/PlayAnimator.vue'
import VideoUploader from '@/components/VideoUploader.vue'
import { BackspaceIcon, PlusIcon, PrinterIcon, TrashIcon, XMarkIcon } from '@heroicons/vue/24/outline'

const route = useRoute()
const router = useRouter()
const { plays, error: playsError, fetchPlays, createPlay, updatePlay } = usePlays()
const { toast } = useToast()
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

// Mobile metadata sheet — slides from top before creating a new play
const showMetadataSheet = ref(false)

function onHeaderButtonClick() {
  if (isNew.value && !form.name.trim()) {
    if (window.innerWidth < 1024) {
      showMetadataSheet.value = true
    } else {
      // Desktop: sidebar is visible, just focus the name field
      document.getElementById('pe-name')?.focus()
    }
  } else {
    save()
  }
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

// Populate form when play data arrives (handles direct-URL navigation)
watch(
  play,
  (p) => {
    if (p) {
      form.name = p.name
      form.description = p.description ?? ''
      form.category = p.category ?? ''
      form.court_type = p.court_type
      form.diagram = JSON.parse(JSON.stringify(p.diagram)) as Diagram
      form.is_scouting = p.is_scouting
      activePhase.value = 0 // reset to phase 1 when play changes
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
  try {
    if (playId.value) {
      const updated = await updatePlay(playId.value, { ...form })
      if (updated) toast('Play saved')
      else toast(playsError.value ?? 'Could not save play', 'error')
    } else {
      const created = await createPlay({ ...form })
      if (!created) toast(playsError.value ?? 'Could not create play', 'error')
      if (created) {
        toast('Play created')
        showMetadataSheet.value = false
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
      <button class="btn-ghost py-1.5 text-sm" @click="router.push('/plays')">
        <BackspaceIcon class="h-5 w-5" />
      </button>
      <h1 class="font-stencil grow text-lg font-bold capitalize leading-tight">
        {{ isNew ? 'New play' : 'Edit play' }}
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

    <!-- Two-column on lg (iPad landscape+): left = metadata/video, right = diagram -->
    <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-5 pt-3">
      <!-- Left column: metadata + video clips -->
      <div class="order-last lg:order-first flex flex-col gap-3 lg:w-64 lg:shrink-0">
        <div>
          <label class="label" for="pe-name">Name</label>
          <input
            id="pe-name"
            v-model="form.name"
            class="input"
            placeholder="Horns flare"
            autofocus
          />
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
            rows="3"
            class="input resize-none"
            placeholder="When to call it, reads, counters…"
          />
        </div>

        <!-- Scouting toggle -->
        <label class="flex cursor-pointer items-center gap-2 rounded-lg border border-ink-700 px-3 py-2.5">
          <input type="checkbox" v-model="form.is_scouting" class="h-4 w-4 rounded accent-rim" />
          <span class="text-sm font-medium">Opponent scouting report</span>
        </label>

        <!-- Roster reference -->
        <div v-if="rosterPlayers.length" class="rounded-lg border border-ink-700 p-3">
          <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Roster</p>
          <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <div v-for="pl in rosterPlayers" :key="pl.id" class="flex items-center gap-1.5">
              <span class="w-6 shrink-0 text-right font-mono text-ink-400 text-xs">#{{ pl.number ?? '—' }}</span>
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
      </div>

      <!-- Right column: diagram (fills remaining width) -->
      <div class="order-first lg:order-last min-w-0 flex-1">
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

  <!-- Mobile metadata sheet: slides down from top before creating a new play -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-300 ease-out"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-200 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-if="showMetadataSheet"
        class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        @click="showMetadataSheet = false"
      />
    </Transition>
    <Transition
      enter-active-class="transition-transform duration-300 ease-out"
      enter-from-class="-translate-y-full"
      leave-active-class="transition-transform duration-200 ease-in"
      leave-to-class="-translate-y-full"
    >
      <div
        v-if="showMetadataSheet"
        class="fixed inset-x-0 top-0 z-50 max-h-[88vh] overflow-y-auto rounded-b-3xl border-b border-ink-700 bg-ink-900 px-4 pb-8 pt-4 shadow-2xl"
      >
        <div class="mb-4 flex items-center justify-between">
          <h2 class="font-stencil text-lg font-bold">New Play</h2>
          <button class="btn-ghost p-1.5" title="Cancel" aria-label="Cancel" @click="showMetadataSheet = false">
            <XMarkIcon class="h-5 w-5" />
          </button>
        </div>
        <div class="flex flex-col gap-3">
          <div>
            <label class="label" for="ms-name">Name</label>
            <input
              id="ms-name"
              v-model="form.name"
              class="input"
              placeholder="Horns flare"
              autofocus
            />
          </div>
          <div>
            <label class="label" for="ms-cat">Category</label>
            <select id="ms-cat" v-model="form.category" class="input">
              <option value="">— No category —</option>
              <option v-for="cat in PLAY_CATEGORIES" :key="cat" :value="cat">{{ cat }}</option>
              <option v-if="legacyCategory" :value="legacyCategory">{{ legacyCategory }} (old)</option>
            </select>
          </div>
          <div>
            <label class="label" for="ms-desc">Notes</label>
            <textarea
              id="ms-desc"
              v-model="form.description"
              rows="3"
              class="input resize-none"
              placeholder="When to call it, reads, counters…"
            />
          </div>
          <label class="flex cursor-pointer items-center gap-2 rounded-lg border border-ink-700 px-3 py-2.5">
            <input type="checkbox" v-model="form.is_scouting" class="h-4 w-4 rounded accent-rim" />
            <span class="text-sm font-medium">Opponent scouting report</span>
          </label>
          <button
            class="btn-primary py-3 text-sm font-semibold"
            :disabled="!form.name.trim() || saving"
            @click="save"
          >
            {{ saving ? 'Saving…' : 'Create play' }}
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>

</template>
