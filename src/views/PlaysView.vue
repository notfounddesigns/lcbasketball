<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { Play, PracticePlan } from '@/types'
import { usePlays } from '@/composables/usePlays'
import { usePracticePlan } from '@/composables/usePracticePlan'
import { useConfirm } from '@/composables/useConfirm'
import { formatDuration, formatPlanDate, blockTitle, totalMinutes } from '@/lib/practice-utils'
import { PLAY_CATEGORIES } from '@/lib/play-categories'
import CourtCanvas from '@/components/CourtCanvas.vue'
import PlayAnimator from '@/components/PlayAnimator.vue'
import PracticePlanModal from '@/components/PracticePlanModal.vue'
import PracticePlanViewer from '@/components/PracticePlanViewer.vue'
import { PencilIcon, DocumentDuplicateIcon, EyeIcon, PlayIcon, PrinterIcon, TrashIcon } from '@heroicons/vue/24/outline'

const router = useRouter()
const { plays, loading, error, fetchPlays, deletePlay, duplicatePlay } = usePlays()
const {
  plans,
  loading: plansLoading,
  error: plansError,
  fetchPlans,
  deletePlan,
} = usePracticePlan()
const { confirm } = useConfirm()

// ---- tabs: playbook / scouting / practice plans ----
type Tab = 'playbook' | 'scouting' | 'practice'
const activeTab = ref<Tab>('playbook')
const search = ref('')

const tabLabels: Record<Tab, string> = {
  playbook: 'Playbook',
  scouting: 'Scouting',
  practice: 'Practice',
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
  fetchPlans()
})

// ---- practice plans ----
const filteredPlans = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return plans.value
  return plans.value.filter((plan) => {
    const haystack = [
      formatPlanDate(plan.planned_for),
      plan.planned_for ?? '',
      plan.name ?? '',
      plan.notes ?? '',
      ...(plan.items ?? []).map((i) => `${i.label ?? ''} ${i.play?.name ?? ''}`),
    ]
      .join(' ')
      .toLowerCase()
    return haystack.includes(q)
  })
})

// null = closed, undefined-plan = "create new", plan = "edit that plan"
const planModalOpen = ref(false)
const editingPlan = ref<PracticePlan | null>(null)
const viewingPlanId = ref<string | null>(null)

// Track by id so the viewer picks up edits made while it's open.
const viewingPlan = computed(() => plans.value.find((p) => p.id === viewingPlanId.value) ?? null)

function openNewPlan() {
  editingPlan.value = null
  planModalOpen.value = true
}

function openEditPlan(plan: PracticePlan) {
  editingPlan.value = plan
  planModalOpen.value = true
}

function onPlanSaved(saved: PracticePlan) {
  planModalOpen.value = false
  editingPlan.value = null
  if (viewingPlanId.value) viewingPlanId.value = saved.id
}

async function onDeletePlan(plan: PracticePlan) {
  const ok = await confirm({
    title: 'Delete practice plan',
    message: `Delete the plan for ${formatPlanDate(plan.planned_for)}? This also removes its clips.`,
    confirmText: 'Delete',
    tone: 'danger',
  })
  if (!ok) return
  await deletePlan(plan.id)
  if (viewingPlanId.value === plan.id) viewingPlanId.value = null
}

function exportPlan(plan: PracticePlan) {
  router.push(`/practice-plans/${plan.id}/print`)
}

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
        <h1 class="font-stencil text-2xl font-extrabold tracking-tight">
          {{ activeTab === 'practice' ? 'Practice Plans' : 'Playbook' }}
        </h1>
        <p class="text-sm text-ink-500">
          {{ activeTab === 'practice' ? 'Block out the session, attach the drills, print it.' : 'Diagram sets, attach film, run it back.' }}
        </p>
      </div>
      <button v-if="activeTab === 'practice'" class="btn-primary" @click="openNewPlan">+ New plan</button>
      <button v-else class="btn-primary capitalize" @click="router.push('/plays/new')">+ New play</button>
    </header>

    <!-- Playbook / Scouting / Practice tabs -->
    <div class="mb-4 flex gap-0 overflow-hidden rounded-lg border border-ink-700">
      <button
        v-for="tab in (['playbook', 'scouting', 'practice'] as const)"
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
        :placeholder="activeTab === 'playbook' ? 'Search plays…' : activeTab === 'scouting' ? 'Search scouting reports…' : 'Search practice plans…'"
      />
    </div>

    <!-- Quick filter by play type -->
    <div
      v-if="activeTab !== 'practice' && availableCategories.length"
      class="mb-4 -mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
    >
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

    <!-- ===================== Practice plans ===================== -->
    <template v-if="activeTab === 'practice'">
      <p v-if="plansError" class="mb-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
        {{ plansError }}
      </p>
      <p v-if="plansLoading" class="text-sm text-ink-500">Loading…</p>

      <div v-if="!plansLoading && !plans.length" class="card p-10 text-center">
        <p class="mb-3 text-ink-500">No practice plans yet.</p>
        <button class="btn-primary" @click="openNewPlan">Build your first plan</button>
      </div>

      <p v-else-if="!plansLoading && !filteredPlans.length" class="text-sm text-ink-500">
        No plans match "{{ search }}".
      </p>

      <div v-else class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 overflow-y-auto pb-nav" style="height: calc(100dvh - 240px)">
        <article v-for="plan in filteredPlans" :key="plan.id" class="card flex h-fit flex-col p-4">
          <div class="flex items-start justify-between gap-2">
            <h3 class="font-semibold leading-tight">{{ formatPlanDate(plan.planned_for) }}</h3>
            <span class="shrink-0 rounded bg-ink-700 px-1.5 py-0.5 text-[11px] text-ink-400">
              {{ formatDuration(totalMinutes(plan.items)) }}
            </span>
          </div>
          <p class="mt-0.5 text-xs uppercase tracking-wide text-rim">
            {{ (plan.items?.length ?? 0) }} block{{ (plan.items?.length ?? 0) === 1 ? '' : 's' }}
            <span v-if="plan.videos?.length"> · {{ plan.videos.length }} clip{{ plan.videos.length === 1 ? '' : 's' }}</span>
          </p>

          <ol class="mt-3 min-h-[3.5rem] space-y-1 text-sm text-ink-500">
            <li v-for="(item, i) in (plan.items ?? []).slice(0, 4)" :key="item.id" class="flex gap-2 truncate">
              <span class="shrink-0 text-ink-600">{{ item.duration_min }}′</span>
              <span class="truncate">{{ blockTitle(item, i) }}</span>
            </li>
            <li v-if="(plan.items?.length ?? 0) > 4" class="text-xs text-ink-600">
              +{{ (plan.items?.length ?? 0) - 4 }} more
            </li>
            <li v-if="!plan.items?.length" class="text-xs italic text-ink-600">No blocks yet</li>
          </ol>

          <div class="mt-3 flex gap-2">
            <span class="ml-auto" />
            <button class="btn-ghost py-1.5 text-xs" title="View plan" @click="viewingPlanId = plan.id">
              <EyeIcon class="h-4 w-4" />
            </button>
            <button class="btn-ghost py-1.5 text-xs" title="Edit plan" @click="openEditPlan(plan)">
              <PencilIcon class="h-4 w-4" />
            </button>
            <button class="btn-ghost py-1.5 text-xs" title="Export for printing" @click="exportPlan(plan)">
              <PrinterIcon class="h-4 w-4" />
            </button>
            <button class="btn-danger py-1.5 text-xs" title="Delete plan" @click="onDeletePlan(plan)">
              <TrashIcon class="h-4 w-4" />
            </button>
          </div>
        </article>
      </div>
    </template>

    <!-- ===================== Plays / scouting ===================== -->
    <template v-else>
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
    </template>

    <!-- Practice plan overlays (mounted regardless of tab so they survive a tab switch) -->
    <PracticePlanViewer
      v-if="viewingPlan"
      :plan="viewingPlan"
      @close="viewingPlanId = null"
      @edit="openEditPlan(viewingPlan)"
      @print="exportPlan(viewingPlan)"
    />
    <PracticePlanModal
      v-if="planModalOpen"
      :plan="editingPlan"
      @close="planModalOpen = false; editingPlan = null"
      @saved="onPlanSaved"
    />
  </section>
</template>
