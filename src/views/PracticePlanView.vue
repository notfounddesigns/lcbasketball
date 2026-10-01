<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { PracticePlan } from '@/types'
import { usePracticePlan } from '@/composables/usePracticePlan'
import { useConfirm } from '@/composables/useConfirm'
import { formatDuration, formatPlanDate, formatTimeWindow, blockRanges, blockTitle, totalMinutes } from '@/lib/practice-utils'
import PracticePlanModal from '@/components/PracticePlanModal.vue'
import PracticePlanViewer from '@/components/PracticePlanViewer.vue'
import { PencilIcon, EyeIcon, PrinterIcon, TrashIcon } from '@heroicons/vue/24/outline'

const router = useRouter()
const { plans, loading, error, fetchPlans, deletePlan } = usePracticePlan()
const { confirm } = useConfirm()

const search = ref('')

onMounted(() => {
  fetchPlans()
})

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

// The clock a card shows is derived once per plan rather than per block row.
const planCards = computed(() =>
  filteredPlans.value.map((plan) => ({
    plan,
    window: formatTimeWindow(plan.start_time, plan.end_time),
    ranges: blockRanges(plan.items ?? [], plan.start_time),
  })),
)

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
</script>

<template>
  <section>
    <header class="mb-4 flex items-center justify-between">
      <div>
        <h1 class="font-stencil text-2xl font-extrabold tracking-tight">Practice Plans</h1>
      </div>
      <button class="btn-primary capitalize" @click="openNewPlan">+ New plan</button>
    </header>

    <div class="mb-4">
      <input v-model="search" class="input" placeholder="Search practice plans…" />
    </div>

    <p v-if="error" class="mb-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
      {{ error }}
    </p>
    <p v-if="loading" class="text-sm text-ink-500">Loading…</p>

    <div v-if="!loading && !plans.length" class="card p-10 text-center">
      <p class="mb-3 text-ink-500">No practice plans yet.</p>
      <button class="btn-primary" @click="openNewPlan">Build your first plan</button>
    </div>

    <p v-else-if="!loading && !filteredPlans.length" class="text-sm text-ink-500">
      No plans match "{{ search }}".
    </p>

    <!-- Same fixed-height scroller as the playbook grid, minus the band the tab
         bar takes up there, so the last row clears the bottom nav. -->
    <div
      v-else
      class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 overflow-y-auto pb-nav"
      style="height: calc(100dvh - 188px)"
    >
      <article v-for="{ plan, window, ranges } in planCards" :key="plan.id" class="card flex h-fit flex-col p-4">
        <div class="flex items-start justify-between gap-2">
          <h3 class="font-semibold leading-tight">{{ formatPlanDate(plan.planned_for) }}</h3>
          <span class="shrink-0 rounded bg-ink-700 px-1.5 py-0.5 text-[11px] text-ink-400">
            {{ formatDuration(totalMinutes(plan.items)) }}
          </span>
        </div>
        <p class="mt-0.5 text-xs uppercase tracking-wide text-red-500">
          <span v-if="window">{{ window }} · </span>
          {{ (plan.items?.length ?? 0) }} block{{ (plan.items?.length ?? 0) === 1 ? '' : 's' }}
          <span v-if="plan.videos?.length"> · {{ plan.videos.length }} clip{{ plan.videos.length === 1 ? '' : 's' }}</span>
        </p>

        <ol class="mt-3 min-h-[3.5rem] space-y-1 text-sm text-ink-500">
          <li v-for="(item, i) in (plan.items ?? []).slice(0, 4)" :key="item.id" class="flex items-center gap-2 truncate">
            <span class="shrink-0 font-mono text-xs text-ink-500">
              {{ plan.start_time ? ranges[i].start : `${item.duration_min}′` }} -
            </span>
            <span class="truncate">{{ blockTitle(item, i) }}</span>
          </li>
          <li v-if="(plan.items?.length ?? 0) > 4" class="text-xs text-ink-500">
            +{{ (plan.items?.length ?? 0) - 4 }} more
          </li>
          <li v-if="!plan.items?.length" class="text-xs italic text-ink-500">No blocks yet</li>
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
