<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Play } from '@/types'
import { usePlays } from '@/composables/usePlays'
import { useConfirm } from '@/composables/useConfirm'
import { CATEGORY_LABELS, PLAY_CATEGORIES, resolveCategory, type PlayCategory } from '@/lib/play-categories'
import CourtCanvas from '@/components/CourtCanvas.vue'
import PlayAnimator from '@/components/PlayAnimator.vue'
import { ChevronLeftIcon, PencilIcon, DocumentDuplicateIcon, PlayIcon, PlusIcon, TrashIcon } from '@heroicons/vue/24/outline'

const route = useRoute()
const router = useRouter()
const { plays, loading, error, fetchPlays, deletePlay, duplicatePlay } = usePlays()
const { confirm } = useConfirm()

// The playbook lives on the Plays tab; the same list in "scouting" form is
// embedded on the Stats page (Scouting tab), next to the games it informs.
const props = defineProps<{ scouting?: boolean }>()
type Tab = 'playbook' | 'scouting'
const activeTab = computed<Tab>(() => (props.scouting ? 'scouting' : 'playbook'))
const search = ref('')

const tabPlays = computed(() =>
  activeTab.value === 'scouting'
    ? plays.value.filter((p) => p.is_scouting)
    : plays.value.filter((p) => !p.is_scouting)
)

// ---- playbook categories ----
// The playbook opens on a grid of category cards; picking one lists its plays.
// The open category lives in the URL (?category=) so returning from the editor
// or the browser back button lands where the coach left off.
const OTHER = 'other'
type CategoryKey = PlayCategory | typeof OTHER

function categoryKey(p: Play): CategoryKey {
  return resolveCategory(p.category) ?? OTHER
}

const selectedCategory = computed<CategoryKey | null>(() => {
  const q = route.query.category
  if (q === OTHER) return OTHER
  return typeof q === 'string' ? resolveCategory(q) : null
})

function openCategory(key: CategoryKey | null) {
  search.value = ''
  router.push({ query: key ? { category: key } : {} })
}

const categoryCounts = computed(() => {
  const counts = new Map<CategoryKey, number>()
  for (const p of tabPlays.value) {
    const k = categoryKey(p)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return counts
})

// Every canonical category is always shown, even when empty, so the playbook's
// shape is the same on every load. "Other" only appears when something needs it
// (uncategorized plays, or ones saved under a retired category).
const categoryCards = computed(() => {
  const cards: { key: CategoryKey; label: string; count: number }[] = PLAY_CATEGORIES.map((c) => ({
    key: c,
    label: CATEGORY_LABELS[c],
    count: categoryCounts.value.get(c) ?? 0,
  }))
  const other = categoryCounts.value.get(OTHER) ?? 0
  if (other) cards.push({ key: OTHER, label: 'Other', count: other })
  return cards
})

const selectedLabel = computed(() =>
  selectedCategory.value === OTHER
    ? 'Other'
    : selectedCategory.value
      ? CATEGORY_LABELS[selectedCategory.value]
      : '',
)

// Playbook landing = the category grid. Searching from it skips the grid and
// searches the whole playbook; scouting has no category split.
const showCategoryGrid = computed(
  () => activeTab.value === 'playbook' && !selectedCategory.value && !search.value.trim(),
)

// Scouting reports are plays flagged is_scouting; the editor pre-ticks the flag.
function newScoutingReport() {
  router.push({ path: '/plays/new', query: { scouting: '1' } })
}

function newPlay() {
  const cat = selectedCategory.value
  router.push(cat && cat !== OTHER ? { path: '/plays/new', query: { category: cat } } : '/plays/new')
}

const filteredPlays = computed(() => {
  const q = search.value.trim().toLowerCase()
  const cat = activeTab.value === 'playbook' ? selectedCategory.value : null
  return tabPlays.value.filter((p) => {
    if (cat && categoryKey(p) !== cat) return false
    if (!q) return true
    return (
      p.name.toLowerCase().includes(q) ||
      (p.category ?? '').toLowerCase().includes(q)
    )
  })
})

onMounted(() => {
  fetchPlays()
})

async function onDelete(p: Play) {
  const ok = await confirm({
    title: 'Delete play',
    message: `Delete "${p.name}"? This also removes its clips.`,
    confirmText: 'Delete',
    tone: 'danger',
  })
  if (!ok) return
  await deletePlay(p.id)
}

async function onDuplicate(p: Play) {
  const copy = await duplicatePlay(p)
  if (copy) router.push(`/plays/${copy.id}`)
}

function phaseCount(p: Play): number {
  return 1 + (p.diagram.phases?.length ?? 0)
}

// ---- inline preview (animate diagram + play attached clips) ----
const previewPlay = ref<Play | null>(null)
const previewMode = ref<'diagram' | 'video'>('diagram')

function openPreview(p: Play, mode: 'diagram' | 'video') {
  previewMode.value = mode
  previewPlay.value = p
}

// ---- drag-to-reorder (localStorage) ----
const STORAGE_KEY = 'lc-plays-order'
function loadCustomOrder(): string[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') } catch { return [] }
}
const customOrder = ref<string[]>(loadCustomOrder())
const draggingId = ref<string | null>(null)

function sortByCustomOrder(list: Play[]): Play[] {
  const orderMap = new Map(customOrder.value.map((id, i) => [id, i]))
  return [...list].sort((a, b) => {
    const ai = orderMap.has(a.id) ? orderMap.get(a.id)! : Infinity
    const bi = orderMap.has(b.id) ? orderMap.get(b.id)! : Infinity
    // Both unknown → keep original order from server (updated_at desc)
    return ai === Infinity && bi === Infinity ? 0 : ai - bi
  })
}

const sortedFiltered = computed(() => sortByCustomOrder(filteredPlays.value))

function onDragStart(e: DragEvent, p: Play) {
  draggingId.value = p.id
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDragOver(e: DragEvent, target: Play) {
  e.preventDefault()
  if (!draggingId.value || draggingId.value === target.id) return
  const ids = sortedFiltered.value.map((p) => p.id)
  const from = ids.indexOf(draggingId.value)
  const to = ids.indexOf(target.id)
  if (from === -1 || to === -1) return
  ids.splice(from, 1)
  ids.splice(to, 0, draggingId.value)
  // Only the visible plays moved: write them back into the slots they hold in
  // the full order so other categories keep their saved order.
  const visible = new Set(ids)
  let next = 0
  const full = sortByCustomOrder(plays.value).map((p) => (visible.has(p.id) ? ids[next++] : p.id))
  customOrder.value = full
  localStorage.setItem(STORAGE_KEY, JSON.stringify(full))
}

function onDragEnd() {
  draggingId.value = null
}
</script>

<template>
  <section>
    <header class="mb-4 flex items-center justify-between">
      <div>
        <h1 v-if="activeTab === 'playbook'" class="font-stencil text-2xl font-extrabold tracking-tight">Playbook</h1>
        <h1 v-else class="font-stencil text-2xl font-extrabold tracking-tight">Scouting Reports</h1>
      </div>
      <button v-if="activeTab === 'playbook'" class="btn-primary capitalize" title="New play" aria-label="New play" @click="newPlay">
        <PlusIcon class="h-5 w-5" /><span class="hidden sm:inline">New Play</span>
      </button>
      <button v-else class="btn-primary capitalize" title="New scouting report" aria-label="New scouting report" @click="newScoutingReport">
        <PlusIcon class="h-5 w-5" /><span class="hidden sm:inline">Scouting Report</span>
      </button>
    </header>

    <div class="mb-4">
      <input
        v-model="search"
        class="input"
        :placeholder="
          activeTab === 'scouting'
            ? 'Search scouting reports…'
            : selectedCategory
              ? `Search ${selectedLabel}…`
              : 'Search all plays…'
        "
      />
    </div>

    <!-- Open category: back to the grid -->
    <div v-if="activeTab === 'playbook' && selectedCategory" class="mb-4 flex items-center gap-2 w-full">
      <button class="btn-ghost px-2 py-1 text-xs" title="All categories" @click="openCategory(null)">
        <ChevronLeftIcon class="h-4 w-4" /> Categories
      </button>
      <div class="flex-1"></div>
      <span class="font-mono text-xs text-red-800 bg-red-300 rounded-full px-3 py-1">{{ categoryCounts.get(selectedCategory) ?? 0 }}</span>
      <h2 class="font-stencil text-lg font-bold tracking-tight">{{ selectedLabel }}</h2>
    </div>

    <!-- ===================== Plays / scouting ===================== -->
    <p v-if="error" class="mb-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
      {{ error }}
    </p>
    <p v-if="loading" class="text-sm text-ink-500">Loading…</p>

    <!-- Playbook landing: one card per category -->
    <div
      v-if="!loading && showCategoryGrid"
      class="grid auto-rows-min grid-cols-2 gap-3 overflow-y-auto lg:px-3 lg:pt-3 pb-nav md:grid-cols-3"
      style="height: calc(100dvh - 240px)"
    >
      <button
        v-for="c in categoryCards"
        :key="c.key"
        class="card flex min-h-[6.5rem] flex-col items-start justify-between p-4 text-left transition hover:ring-2 hover:ring-rim"
        @click="openCategory(c.key)"
      >
        <span class="font-stencil text-lg font-bold leading-tight">{{ c.label }}</span>
        <span class="mt-2 text-xs text-ink-500">
          <span class="font-mono text-rim">{{ c.count }}</span>
          {{ c.key === 'Drill' ? (c.count === 1 ? 'drill' : 'drills') : (c.count === 1 ? 'play' : 'plays') }}
        </span>
      </button>
    </div>

    <template v-else-if="!loading">
      <div v-if="activeTab === 'scouting' && !tabPlays.length" class="card p-10 text-center">
        <p class="mb-3 text-ink-500">No scouting reports yet.</p>
        <button class="btn-primary" @click="newScoutingReport">Add scouting report</button>
      </div>

      <div v-else-if="!search && selectedCategory && !filteredPlays.length" class="card p-10 text-center">
        <p class="mb-3 text-ink-500">Nothing in {{ selectedLabel }} yet.</p>
        <button class="btn-primary" @click="newPlay">
          {{ selectedCategory === 'Drill' ? 'Diagram a drill' : 'Diagram a play' }}
        </button>
      </div>

      <p v-else-if="!filteredPlays.length" class="text-sm text-ink-500">
        No plays match "{{ search }}"<template v-if="selectedCategory"> in {{ selectedLabel }}</template>.
      </p>
    </template>

    <!-- The category header adds a band above the grid, so the fixed height has
         to give it back or the last row slides under the bottom nav. -->
    <div
      v-if="!showCategoryGrid"
      class="flex flex-col gap-4 overflow-y-auto pb-nav md:flex-row md:flex-wrap md:justify-center md:items-start"
      :style="{ height: activeTab === 'playbook' && selectedCategory ? 'calc(100dvh - 286px)' : scouting ? 'calc(100dvh - 300px)' : 'calc(100dvh - 240px)' }"
    >
      <article
        v-for="p in sortedFiltered"
        :key="p.id"
        class="card cursor-grab flex-shrink-0 overflow-hidden active:cursor-grabbing py-1"
        :class="draggingId === p.id ? 'opacity-40 ring-2 ring-rim' : ''"
        draggable="true"
        @dragstart="onDragStart($event, p)"
        @dragover="onDragOver($event, p)"
        @dragend="onDragEnd"
      >
        <div class="pointer-events-none w-2/3 mx-auto overflow-hidden bg-court-wood rounded-lg">
          <CourtCanvas :model-value="p.diagram" :editable="false" :auto-height="true" :total-phases="phaseCount(p)" />
        </div>
        <div class="p-3">
          <div class="flex items-start justify-between gap-2">
            <h3 class="font-semibold leading-tight">{{ p.name }}</h3>
            <div class="flex shrink-0 items-center gap-1.5">
              <button
                v-if="phaseCount(p) > 1"
                class="inline-flex rounded bg-ink-700 px-1.5 py-0.5 text-[11px] text-ink-400"
                @click="openPreview(p, 'diagram')">
                {{ phaseCount(p) }} phases
              </button>
              <button
                v-if="p.videos?.length"
                class="inline-flex rounded bg-ink-700 px-1.5 py-0.5 text-[11px] text-ink-500"
                title="Preview clips"
                @click="openPreview(p, 'video')">
                <PlayIcon class="h-4 w-4" />{{ p.videos.length }}
              </button>
            </div>
          </div>
          <p v-if="p.category" class="mt-0.5 text-xs uppercase tracking-wide text-rim">{{ p.category }}</p>
          <!-- <p v-if="p.description" class="mt-1 line-clamp-2 text-sm text-ink-500">{{ p.description }}</p> -->
          <div class="mt-3 flex gap-2">
            <span class="ml-auto" />
            <button
              class="btn-ghost py-1.5 text-xs"
              title="Preview"
              @click="openPreview(p, p.videos?.length ? 'video' : 'diagram')">
              <PlayIcon class="h-4 w-4" />
            </button>
            <button class="btn-ghost py-1.5 text-xs" title="Open editor" @click="router.push(`/plays/${p.id}`)">
              <PencilIcon class="h-4 w-4" />
            </button>
            <button class="btn-ghost py-1.5 text-xs" title="Duplicate" @click="onDuplicate(p)">
              <DocumentDuplicateIcon class="h-4 w-4" />
            </button>
            <button class="btn-danger py-1.5 text-xs" @click="onDelete(p)">
              <TrashIcon class="h-4 w-4" />
            </button>
          </div>
        </div>
      </article>
    </div>

    <!-- Inline preview overlay: animated diagram + attached clips -->
    <PlayAnimator
      v-if="previewPlay"
      :name="previewPlay.name"
      :diagram="previewPlay.diagram"
      :videos="previewPlay.videos"
      :default_preview_mode="previewMode"
      @close="previewPlay = null"
    />
  </section>
</template>
