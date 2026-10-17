<script setup lang="ts">
import { useAccess } from '@/composables/useAccess'
import { computed, ref } from 'vue'
import type { PracticePlan } from '@/types'
import { blockRanges, blockTitle, formatDuration, formatPlanDate, formatTimeWindow, totalMinutes } from '@/lib/practice-utils'
import { useDialog } from '@/composables/useDialog'
import CourtCanvas from '@/components/CourtCanvas.vue'
import { DocumentDuplicateIcon, PencilIcon, PrinterIcon } from '@heroicons/vue/24/outline'

const props = defineProps<{ plan: PracticePlan }>()
const emit = defineEmits<{ close: []; edit: []; duplicate: []; print: [] }>()
const { canEdit } = useAccess()

const items = computed(() => props.plan.items ?? [])
const ranges = computed(() => blockRanges(items.value, props.plan.start_time))
const timeWindow = computed(() => formatTimeWindow(props.plan.start_time, props.plan.end_time))
const playableVideos = computed(() => (props.plan.videos ?? []).filter((v) => v.url))

const dialogEl = ref<HTMLElement | null>(null)
useDialog(dialogEl, () => emit('close'))
</script>

<template>
  <Teleport to="body">
    <div
      ref="dialogEl"
      class="fixed inset-0 z-50 flex flex-col bg-ink-600/45 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="plan-viewer-title"
    >
      <!-- header -->
      <div class="mb-4 flex items-center gap-3">
        <button class="btn-ghost py-1.5 text-sm" @click="emit('close')">← Close</button>
        <div class="grow truncate">
          <h2 id="plan-viewer-title" class="truncate font-stencil text-lg font-bold">
            {{ formatPlanDate(plan.planned_for) }}<span v-if="plan.name" class="font-sans text-sm font-normal text-ink-400"> · {{ plan.name }}</span>
          </h2>
          <p class="text-xs text-ink-500">
            <span v-if="timeWindow">{{ timeWindow }} · </span>
            {{ items.length }} block{{ items.length === 1 ? '' : 's' }} · {{ formatDuration(totalMinutes(items)) }}
          </p>
        </div>
        <button v-if="canEdit" class="btn-ghost shrink-0 py-1.5 text-sm" title="Edit plan" aria-label="Edit plan" @click="emit('edit')">
          <PencilIcon class="h-4 w-4" />
        </button>
        <button v-if="canEdit" class="btn-ghost shrink-0 py-1.5 text-sm" title="Duplicate plan" aria-label="Duplicate plan" @click="emit('duplicate')">
          <DocumentDuplicateIcon class="h-4 w-4" />
        </button>
        <button class="btn-ghost shrink-0 py-1.5 text-sm" title="Export for printing" aria-label="Export for printing" @click="emit('print')">
          <PrinterIcon class="h-4 w-4" />
        </button>
      </div>

      <!-- body -->
      <div class="mx-auto bg-ink-900/65 rounded-lg w-full max-w-3xl flex-1 overflow-y-auto p-6">
        <p v-if="plan.notes" class="card mb-4 whitespace-pre-wrap p-4 text-sm leading-relaxed">{{ plan.notes }}</p>

        <p v-if="!items.length" class="card p-8 text-center text-sm text-ink-500">
          This plan has no time blocks yet.
        </p>

        <ol class="flex flex-col gap-3">
          <li v-for="(item, i) in items" :key="item.id" class="card p-4">
            <div class="flex items-start gap-3">
              <div class="shrink-0 text-center">
                <p class="font-stencil text-lg font-bold leading-none text-rim">{{ item.duration_min }}</p>
                <p class="text-[10px] uppercase tracking-wider text-ink-500">min</p>
              </div>
              <div class="min-w-0 grow">
                <h3 class="font-semibold leading-tight">{{ blockTitle(item, i) }}</h3>
                <p class="mt-0.5 text-xs text-ink-500">
                  {{ ranges[i].start }} – {{ ranges[i].end }}
                  <span v-if="item.play"> · {{ item.play.name }}</span>
                </p>
                <p v-if="item.notes" class="mt-2 whitespace-pre-wrap text-sm text-ink-500">{{ item.notes }}</p>
              </div>
              <div v-if="item.play" class="pointer-events-none w-28 shrink-0">
                <CourtCanvas :model-value="item.play.diagram" :editable="false" :total-phases="1" auto-height />
              </div>
            </div>
          </li>
        </ol>

        <div v-if="playableVideos.length" class="mt-4 grid gap-4 sm:grid-cols-2">
          <figure v-for="v in playableVideos" :key="v.id" class="card overflow-hidden">
            <video :src="v.url!" controls preload="metadata" playsinline class="aspect-video w-full bg-black" />
            <figcaption class="truncate p-2 text-xs text-ink-500">{{ v.title ?? 'Untitled clip' }}</figcaption>
          </figure>
        </div>
      </div>
    </div>
  </Teleport>
</template>
