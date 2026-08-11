<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { usePracticePlan } from '@/composables/usePracticePlan'
import { blockRanges, blockTitle, formatDuration, formatPlanDate, totalMinutes } from '@/lib/practice-utils'
import { diagramPhases } from '@/lib/diagram-utils'
import CourtCanvas from '@/components/CourtCanvas.vue'

const route = useRoute()
const { plans, fetchPlans } = usePracticePlan()

const plan = computed(() => plans.value.find((p) => p.id === route.params.id) ?? null)
const items = computed(() => plan.value?.items ?? [])
const ranges = computed(() => blockRanges(items.value))

// One row per time block, with the attached drill flattened into its phases so
// the sheet prints every phase of the play, not just the first. Built once here
// rather than in the template so each CourtCanvas keeps a stable diagram prop.
const rows = computed(() =>
  items.value.map((item, index) => ({
    item,
    range: ranges.value[index],
    title: blockTitle(item, index),
    phases: item.play ? diagramPhases(item.play.diagram) : [],
  })),
)

const ready = ref(false)

onMounted(async () => {
  if (!plans.value.length) await fetchPlans()
  ready.value = true
  // Wait for Teleport + CourtCanvas to mount into <body> before printing
  await nextTick()
  setTimeout(() => window.print(), 400)
})
</script>

<template>
  <div v-if="!ready || !plan" class="flex h-screen items-center justify-center text-ink-500">
    Loading…
  </div>

  <!-- Teleport to <body> so the print CSS selector works — see PrintPlayView. -->
  <Teleport v-else to="body">
    <div class="print-sheet bg-white text-black">
      <div class="print-page">
        <header class="mb-5 border-b-2 border-black pb-3">
          <div class="flex items-baseline justify-between">
            <p class="mt-1 text-sm font-semibold uppercase tracking-wide text-gray-600">
              {{ formatPlanDate(plan.planned_for, { weekday: 'long', month: 'long' }) }}
            </p>
            <img src="/LCLogo.png" alt="LC Basketball" class="w-1/6" />
            <span class="text-sm font-semibold text-gray-600">
              {{ items.length }} block{{ items.length === 1 ? '' : 's' }} · {{ formatDuration(totalMinutes(items)) }}
            </span>
          </div>
        </header>

        <div v-if="plan.notes" class="mb-5 rounded border border-gray-300 p-4">
          <p class="mb-1 text-xs font-bold uppercase tracking-wide text-gray-500">Session notes</p>
          <p class="whitespace-pre-wrap text-sm leading-relaxed">{{ plan.notes }}</p>
        </div>

        <table class="w-full border-collapse text-sm">
          <thead>
            <tr class="border-b border-gray-400 text-left text-xs uppercase tracking-wide text-gray-500">
              <th class="w-24 py-2 pr-2 font-bold">Time</th>
              <th class="w-14 py-2 pr-2 font-bold">Min</th>
              <th class="py-2 font-bold">Block</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.item.id" class="break-inside-avoid border-b border-gray-200 align-top">
              <td class="py-3 pr-2 font-mono text-xs text-gray-600">{{ row.range.start }}–{{ row.range.end }}</td>
              <td class="py-3 pr-2 font-bold">{{ row.item.duration_min }}</td>
              <td class="py-3">
                <p class="font-semibold">{{ row.title }}</p>
                <p v-if="row.item.play" class="text-xs uppercase tracking-wide text-gray-500">Drill: {{ row.item.play.name }}</p>
                <p v-if="row.item.notes" class="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{{ row.item.notes }}</p>
                <div v-if="row.item.play" class="mt-4 rounded border border-gray-300 p-4">
                  <header class="mb-4 flex items-baseline justify-between gap-3 border-b-2 border-black pb-3">
                    <h2 class="text-2xl font-extrabold tracking-tight">{{ row.item.play.name }}</h2>
                    <span v-if="row.phases.length > 1" class="shrink-0 text-sm font-semibold text-gray-600">
                      {{ row.phases.length }} phases
                    </span>
                  </header>

                  <!-- Multi-phase drills print as a grid so the whole sequence is on the sheet -->
                  <div :class="row.phases.length > 1 ? 'grid grid-cols-2 gap-4' : 'mx-auto w-1/2 max-w-lg'">
                    <figure v-for="(phase, p) in row.phases" :key="p" class="break-inside-avoid">
                      <figcaption
                        v-if="row.phases.length > 1"
                        class="mb-1 text-xs font-bold uppercase tracking-wide text-gray-500"
                      >
                        Phase {{ p + 1 }}
                      </figcaption>
                      <div class="court-diagram">
                        <CourtCanvas
                          :model-value="phase"
                          :editable="false"
                          :total-phases="row.phases.length"
                          auto-height
                        />
                      </div>
                    </figure>
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        <p v-if="!items.length" class="py-6 text-center text-sm text-gray-500">No time blocks in this plan.</p>
      </div>
    </div>
  </Teleport>
</template>

<style>
/* ── PRINT ── */
@media print {
  /* Hide everything except the teleported print-sheet (direct body child) */
  body > *:not(.print-sheet) { display: none !important; }
  body, html { background: white !important; overflow: visible !important; }
  .print-sheet { display: block !important; }
  .print-page {
    page-break-after: always;
    break-after: page;
    padding: 1.5rem;
  }
  .print-page:last-child {
    page-break-after: avoid;
    break-after: avoid;
  }
}

/* ── SCREEN (print preview) ── */
@media screen {
  .print-sheet {
    position: fixed;
    inset: 0;
    z-index: 9999;
    overflow-y: auto;
    padding: 2rem;
  }
  .print-page {
    max-width: 720px;
    margin: 0 auto 4rem;
  }
}
</style>
