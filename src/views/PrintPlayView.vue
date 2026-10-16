<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import type { Diagram } from '@/types'
import { usePlays } from '@/composables/usePlays'
import { diagramPhases } from '@/lib/diagram-utils'
import CourtCanvas from '@/components/CourtCanvas.vue'
import PrintToolbar from '@/components/PrintToolbar.vue'

const route = useRoute()
const { plays, fetchPlays } = usePlays()

const play = computed(() => plays.value.find((p) => p.id === route.params.id) ?? null)

const allPhases = computed<Diagram[]>(() => (play.value ? diagramPhases(play.value.diagram) : []))

const ready = ref(false)

let printTimer: ReturnType<typeof setTimeout> | undefined

onMounted(async () => {
  if (!plays.value.length) await fetchPlays()
  ready.value = true
  // Nothing to print for a missing play — show "not found" instead of
  // sending the loading screen to the printer.
  if (!play.value) return
  // Wait for Teleport + CourtCanvas to mount into <body> before printing
  await nextTick()
  printTimer = setTimeout(() => window.print(), 400)
})

onBeforeUnmount(() => clearTimeout(printTimer))
</script>

<template>
  <!-- Loading indicator stays in the normal router slot -->
  <div v-if="!ready" class="flex h-screen items-center justify-center text-ink-500">
    Loading…
  </div>
  <div v-else-if="!play" class="flex h-screen flex-col items-center justify-center gap-3 text-ink-500">
    <p>This play couldn't be found.</p>
    <RouterLink to="/plays" class="btn-ghost text-sm">Back</RouterLink>
  </div>

  <!-- Teleport to <body> so the print CSS selector works:
       body > *:not(.print-sheet) targets #app and hides it,
       while this sibling .print-sheet remains visible. -->
  <Teleport v-else to="body">
    <div class="print-sheet bg-white text-black">
      <PrintToolbar back-to="/plays" />
      <!-- Each phase gets its own page -->
      <div
        v-for="(phase, idx) in allPhases"
        :key="idx"
        class="print-page"
      >
        <header class="mb-4 border-b-2 border-black pb-3">
          <div class="flex items-baseline justify-between">
            <h1 class="text-2xl font-extrabold tracking-tight">{{ play.name }}</h1>
            <span v-if="allPhases.length > 1" class="text-sm font-semibold text-gray-600">
              Phase {{ idx + 1 }} / {{ allPhases.length }}
            </span>
          </div>
          <div class="mt-1 flex items-center gap-4 text-sm text-gray-600">
            <span v-if="play.category" class="font-semibold uppercase tracking-wide">{{ play.category }}</span>
            <span v-if="play.is_scouting" class="rounded bg-gray-200 px-2 py-0.5 text-xs font-bold uppercase">Scouting</span>
          </div>
        </header>

        <div class="court-diagram mx-auto max-w-lg">
          <CourtCanvas :model-value="phase" :total-phases="allPhases.length" auto-height />
        </div>

        <div v-if="play.description && idx === 0" class="mt-6 rounded border border-gray-300 p-4">
          <p class="mb-1 text-xs font-bold uppercase tracking-wide text-gray-500">Notes</p>
          <p class="whitespace-pre-wrap text-sm leading-relaxed">{{ play.description }}</p>
        </div>
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
  /* Teleported element covers the full viewport as a white preview overlay */
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
