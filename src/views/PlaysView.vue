<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { Play } from '@/types'
import { usePlays } from '@/composables/usePlays'
import { useConfirm } from '@/composables/useConfirm'
import { PLAY_CATEGORIES } from '@/lib/play-categories'
import CourtCanvas from '@/components/CourtCanvas.vue'
import PlayAnimator from '@/components/PlayAnimator.vue'
import { PencilIcon, DocumentDuplicateIcon, PlayIcon, TrashIcon } from '@heroicons/vue/24/outline'

const router = useRouter()
const { plays, loading, error, fetchPlays, deletePlay, duplicatePlay } = usePlays()
const { confirm } = useConfirm()

// ---- tabs: playbook / scouting ----
type Tab = 'playbook' | 'scouting'
const activeTab = ref<Tab>('playbook')
const search = ref('')

const tabLabels: Record<Tab, string> = {
  playbook: 'Playbook',
  scouting: 'Scouting',
}

const tabPlays = computed(() =>
  activeTab.value === 'scouting'
    ? plays.value.filter((p) => p.is_scouting)
    : plays.value.filter((p) => !p.is_scouting)
)

// ---- quick filter by play type ----
const categoryFilter = ref<string | null>(null)

// Only the types actually present in this tab, in the canonical order, so the
// chip row never offers a filter that would match nothing. Types not in the
// canonical list (legacy free-text categories) are kept, sorted, at the end.
const availableCategories = computed(() => {
  const present = new Set(
    tabPlays.value
      .map((p) => p.category?.trim())
      .filter((c): c is string => Boolean(c)),
  )
  const known = PLAY_CATEGORIES.filter((c) => present.has(c))
  const extra = [...present].filter((c) => !PLAY_CATEGORIES.includes(c as never)).sort()
  return [...known, ...extra]
})

function categoryCount(category: string): number {
  return tabPlays.value.filter((p) => p.category?.trim() === category).length
}

// Drop a filter that no longer matches anything — e.g. after deleting the last
// play of that type — so the grid can't get stuck showing zero results.
watch(availableCategories, (cats) => {
  if (categoryFilter.value && !cats.includes(categoryFilter.value)) {
    categoryFilter.value = null
  }
})

const filteredPlays = computed(() => {
  const q = search.value.trim().toLowerCase()
  return tabPlays.value.filter((p) => {
    if (categoryFilter.value && p.category?.trim() !== categoryFilter.value) return false
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

// ---- drag-to-reorder (localStorage) ----
const STORAGE_KEY = 'lc-plays-order'
function loadCustomOrder(): string[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') } catch { return [] }
}
const customOrder = ref<string[]>(loadCustomOrder())
const draggingId = ref<string | null>(null)

const sortedFiltered = computed(() => {
  const orderMap = new Map(customOrder.value.map((id, i) => [id, i]))
  return [...filteredPlays.value].sort((a, b) => {
    const ai = orderMap.has(a.id) ? orderMap.get(a.id)! : Infinity
    const bi = orderMap.has(b.id) ? orderMap.get(b.id)! : Infinity
    // Both unknown → keep original order from server (updated_at desc)
    return ai === Infinity && bi === Infinity ? 0 : ai - bi
  })
})

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
  customOrder.value = ids
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
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
      <button v-if="activeTab === 'playbook'" class="btn-primary capitalize" @click="router.push('/plays/new')">+ New Play</button>
      <button v-else class="btn-primary capitalize" @click="router.push('/scout/new')">+ Scouting Report</button>
    </header>

    <!-- Playbook / Scouting -->
    <div class="mb-4 flex gap-0 overflow-hidden rounded-lg border border-ink-700">
      <button
        v-for="tab in (['playbook', 'scouting'] as const)"
        :key="tab"
        :class="[
          'flex-1 py-2 text-sm font-medium transition',
          activeTab === tab ? 'bg-ink-700 text-chalk' : 'text-ink-500 hover:text-chalk',
        ]"
        @click="activeTab = tab; search = ''; categoryFilter = null"
      >
        {{ tabLabels[tab] }}
      </button>
    </div>

    <div class="mb-4">
      <input
        v-model="search"
        class="input"
        :placeholder="activeTab === 'playbook' ? 'Search plays…' : 'Search scouting reports…'"
      />
    </div>

    <!-- Quick filter by play type -->
    <div v-if="availableCategories.length" class="mb-4 -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      <button
        :class="[
          'shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition',
          categoryFilter === null
            ? 'bg-rim text-white'
            : 'border border-ink-600 bg-ink-800 text-ink-500 hover:text-chalk',
        ]"
        @click="categoryFilter = null"
      >
        All <span class="font-mono opacity-70">{{ tabPlays.length }}</span>
      </button>
      <button
        v-for="cat in availableCategories"
        :key="cat"
        :class="[
          'shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold transition',
          categoryFilter === cat
            ? 'bg-rim text-white'
            : 'border border-ink-600 bg-ink-800 text-ink-500 hover:text-chalk',
        ]"
        @click="categoryFilter = categoryFilter === cat ? null : cat"
      >
        {{ cat }} <span class="font-mono opacity-70">{{ categoryCount(cat) }}</span>
      </button>
    </div>

    <!-- ===================== Plays / scouting ===================== -->
    <p v-if="error" class="mb-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
      {{ error }}
    </p>
    <p v-if="loading" class="text-sm text-ink-500">Loading…</p>

    <div v-if="!loading && !tabPlays.length" class="card p-10 text-center">
      <p class="mb-3 text-ink-500">
        {{ activeTab === 'playbook' ? 'No plays yet.' : 'No scouting reports yet.' }}
      </p>
      <button class="btn-primary" @click="router.push('/plays/new')">
        {{ activeTab === 'playbook' ? 'Diagram your first play' : 'Add scouting report' }}
      </button>
    </div>

    <p v-else-if="!loading && tabPlays.length && !filteredPlays.length" class="text-sm text-ink-500">
      No plays match
      <template v-if="search">"{{ search }}"</template>
      <template v-if="search && categoryFilter"> in </template>
      <template v-if="categoryFilter">{{ categoryFilter }}</template>.
    </p>

    <!-- The chip row adds a band above the grid, so the fixed height has to give
         it back or the last row slides under the bottom nav. -->
    <div
      class="flex flex-col gap-4 overflow-y-auto pb-nav md:flex-row md:flex-wrap md:justify-center md:items-start"
      :style="{ height: availableCategories.length ? 'calc(100dvh - 286px)' : 'calc(100dvh - 240px)' }"
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
                @click="previewPlay = p, previewPlay.default_preview_mode = 'diagram'">
                {{ phaseCount(p) }} phases
              </button>
              <button
                v-if="p.videos?.length"
                class="inline-flex rounded bg-ink-700 px-1.5 py-0.5 text-[11px] text-ink-500"
                title="Preview clips"
                @click="previewPlay = p, previewPlay.default_preview_mode = 'video'">
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
              @click="previewPlay = p, previewPlay.default_preview_mode = p.videos?.length ? 'video' : 'diagram'">
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
      :default_preview_mode="previewPlay.default_preview_mode"
      @close="previewPlay = null"
    />
  </section>
</template>
