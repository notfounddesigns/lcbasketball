<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { PracticePlan, PracticePlanVideo, TimeBlockDraft } from '@/types'
import { usePlays } from '@/composables/usePlays'
import { usePracticePlan } from '@/composables/usePracticePlan'
import {
  addMinutesToTime,
  blockRanges,
  formatDuration,
  formatTimeWindow,
  toTimeInput,
  totalMinutes,
  windowMinutes,
} from '@/lib/practice-utils'
import CourtCanvas from '@/components/CourtCanvas.vue'
import { randomQuote } from '@/lib/quotes'
import { ArrowDownIcon, ArrowPathIcon, ArrowUpIcon, PlusIcon, TrashIcon, XMarkIcon } from '@heroicons/vue/24/outline'

// `plan` present = edit an existing plan; absent = create a new one.
const props = defineProps<{ plan?: PracticePlan | null }>()
const emit = defineEmits<{ close: []; saved: [plan: PracticePlan] }>()

const { plays, fetchPlays } = usePlays()
const { createPlan, updatePlan, uploadPlanVideo, deletePlanVideo, error } = usePracticePlan()

const isEdit = computed(() => Boolean(props.plan))

function emptyBlock(): TimeBlockDraft {
  return { label: '', duration_min: 15, play_id: null, notes: '' }
}

const today = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD, local
const date = ref(props.plan?.planned_for ?? today)
const startTime = ref(toTimeInput(props.plan?.start_time))
const endTime = ref(toTimeInput(props.plan?.end_time))
const notes = ref(props.plan?.notes ?? '')

// New plans start with a random sports quote; an existing plan keeps whatever it
// was saved with (including none). Either way it's plain text the coach can edit.
const initialQuote = props.plan ? null : randomQuote()
const quote = ref(props.plan ? props.plan.quote ?? '' : initialQuote!.text)
const quoteAuthor = ref(props.plan ? props.plan.quote_author ?? '' : initialQuote!.author)

function regenerateQuote() {
  const q = randomQuote(quote.value)
  quote.value = q.text
  quoteAuthor.value = q.author
}

const blocks = ref<TimeBlockDraft[]>(
  props.plan?.items?.length
    ? props.plan.items.map((i) => ({
        label: i.label ?? '',
        duration_min: i.duration_min,
        play_id: i.play_id,
        notes: i.notes ?? '',
      }))
    : [emptyBlock()],
)

// Clips are staged locally so Cancel really cancels: nothing is uploaded or
// removed until Create/Save runs.
const stagedFiles = ref<File[]>([])
const removedVideoIds = ref<string[]>([])
const fileInput = ref<HTMLInputElement | null>(null)

const busy = ref(false)
const localError = ref<string | null>(null)

const MAX_FILE_BYTES = 50 * 1024 * 1024 // 50 MB, matching VideoUploader

const playbookPlays = computed(() => plays.value.filter((p) => !p.is_scouting))
const scoutingPlays = computed(() => plays.value.filter((p) => p.is_scouting))

// v-model.number hands back NaN while a duration field is mid-edit, so the
// timeline works off normalized copies rather than the raw drafts.
const durations = computed(() =>
  blocks.value.map((b) => ({ duration_min: Number(b.duration_min) || 0 })),
)

const totalMins = computed(() => totalMinutes(durations.value))

// Live clock for each block, recomputed as durations and the start time change.
const ranges = computed(() => blockRanges(durations.value, startTime.value || null))

const timeWindow = computed(() => formatTimeWindow(startTime.value || null, endTime.value || null))
const windowMins = computed(() => windowMinutes(startTime.value || null, endTime.value || null))

// How the blocks measure up against the window, once both ends are set. Only a
// hint — a plan that runs long still saves.
const windowFit = computed(() => {
  if (windowMins.value === null) return null
  const diff = totalMins.value - windowMins.value
  if (diff === 0) return { over: false, text: 'blocks fill the window exactly' }
  return diff > 0
    ? { over: true, text: `${formatDuration(diff)} over the window` }
    : { over: false, text: `${formatDuration(-diff)} unscheduled` }
})

// The clock the last block ends on — what "fit to blocks" snaps the end time to.
const suggestedEnd = computed(() => addMinutesToTime(startTime.value || null, totalMins.value))

// Setting a start time on a plan with no end yet fills one in from the blocks;
// an end the coach has already chosen is never moved out from under them.
watch(startTime, () => {
  if (!endTime.value && suggestedEnd.value) endTime.value = suggestedEnd.value
})

function fitEndToBlocks() {
  if (suggestedEnd.value) endTime.value = suggestedEnd.value
}

const keptVideos = computed<PracticePlanVideo[]>(() =>
  (props.plan?.videos ?? []).filter((v) => !removedVideoIds.value.includes(v.id)),
)

onMounted(() => {
  if (!plays.value.length) fetchPlays()
})

function diagramFor(playId: string | null) {
  return plays.value.find((p) => p.id === playId)?.diagram ?? null
}

function addBlock() {
  blocks.value = [...blocks.value, emptyBlock()]
}

function removeBlock(index: number) {
  // Always leave one block standing so the form is never empty.
  if (blocks.value.length === 1) blocks.value = [emptyBlock()]
  else blocks.value = blocks.value.filter((_, i) => i !== index)
}

function moveBlock(index: number, delta: number) {
  const to = index + delta
  if (to < 0 || to >= blocks.value.length) return
  const next = [...blocks.value]
  const [moved] = next.splice(index, 1)
  next.splice(to, 0, moved)
  blocks.value = next
}

function onPickFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const picked = Array.from(input.files ?? [])
  localError.value = null
  for (const file of picked) {
    if (!file.type.startsWith('video/')) {
      localError.value = 'Pick a video file (mp4, mov, webm).'
      continue
    }
    if (file.size > MAX_FILE_BYTES) {
      localError.value = `"${file.name}" is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 50 MB.`
      continue
    }
    stagedFiles.value = [...stagedFiles.value, file]
  }
  input.value = ''
}

function unstageFile(index: number) {
  stagedFiles.value = stagedFiles.value.filter((_, i) => i !== index)
}

function markVideoRemoved(v: PracticePlanVideo) {
  removedVideoIds.value = [...removedVideoIds.value, v.id]
}

async function onSubmit() {
  if (busy.value) return
  if (!date.value) {
    localError.value = 'Pick a date for this practice.'
    return
  }
  // The blocks hang off the start time, so an end time on its own has nothing
  // to anchor to.
  if (endTime.value && !startTime.value) {
    localError.value = 'Add a start time — the end time needs something to run from.'
    return
  }
  busy.value = true
  localError.value = null
  error.value = null

  const draft = {
    name: null,
    planned_for: date.value,
    start_time: startTime.value || null,
    end_time: endTime.value || null,
    notes: notes.value.trim() || null,
    quote: quote.value.trim() || null,
    // An author with no quote has nothing to attribute.
    quote_author: (quote.value.trim() && quoteAuthor.value.trim()) || null,
  }

  const saved = props.plan
    ? await updatePlan(props.plan.id, draft, blocks.value)
    : await createPlan(draft, blocks.value)

  if (!saved) {
    localError.value = error.value ?? 'Could not save the plan.'
    busy.value = false
    return
  }

  for (const id of removedVideoIds.value) {
    const video = props.plan?.videos?.find((v) => v.id === id)
    if (video) await deletePlanVideo(video)
  }
  for (const file of stagedFiles.value) {
    await uploadPlanVideo(saved.id, file, file.name)
  }

  busy.value = false
  emit('saved', saved)
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm" @click.self="!busy && emit('close')">
      <div class="card my-4 w-full max-w-2xl overflow-y-hidden border-ink-700 shadow-2xl" role="dialog" aria-modal="true">
        <!-- header -->
        <header class="flex items-center justify-between gap-3 border-b border-ink-700/60 px-5 py-4">
          <div>
            <h2 class="font-stencil text-xl font-extrabold tracking-tight">
              {{ isEdit ? 'Edit Practice Plan' : 'New Practice Plan' }}
            </h2>
            <p class="text-xs text-ink-500">
              {{ blocks.length }} block{{ blocks.length === 1 ? '' : 's' }} · {{ formatDuration(totalMins) }} total
              <span v-if="timeWindow"> · {{ timeWindow }}</span>
            </p>
          </div>
          <button class="btn-ghost px-2 py-1.5" title="Close" @click="emit('close')">
            <XMarkIcon class="h-5 w-5" />
          </button>
        </header>

        <div class="flex flex-col gap-5 px-5 py-4 overflow-y-auto" style="height: calc(90dvh - 4rem - 4rem);">
          <!-- date + practice window -->
          <div>
            <div class="flex flex-col gap-2 sm:flex-row">
              <div class="grow">
                <label class="label" for="plan-date">Date</label>
                <input id="plan-date" v-model="date" type="date" class="input" />
              </div>
              <div class="sm:w-36">
                <label class="label" for="plan-start">Start time</label>
                <input id="plan-start" v-model="startTime" type="time" class="input" />
              </div>
              <div class="sm:w-36">
                <label class="label" for="plan-end">End time</label>
                <input id="plan-end" v-model="endTime" type="time" class="input" />
              </div>
            </div>

            <p v-if="windowFit" class="mt-1.5 flex items-center gap-2 text-xs" :class="windowFit.over ? 'text-red-300' : 'text-ink-500'">
              <button
                v-if="suggestedEnd && suggestedEnd !== endTime"
                class="btn-ghost px-2 py-0.5 text-[11px]"
                @click="fitEndToBlocks"
              >
                Fit end to blocks
              </button>
            </p>
            <p v-else-if="!startTime" class="mt-1.5 text-xs text-ink-500">
              Add a start time to lay the blocks out on the clock.
            </p>
          </div>

          <!-- time blocks -->
          <div>
            <span class="label mb-0">Time Blocks</span>
            
            <div class="flex flex-col gap-3">
              <div
                v-for="(block, i) in blocks"
                :key="i"
                class="rounded-xl border border-ink-700 bg-ink-900/40 p-3"
              >
                <div class="mb-2 flex items-center gap-2">
                  <span class="font-stencil text-sm font-bold text-ink-500">#{{ i + 1 }}</span>
                  <span class="font-mono text-xs" :class="startTime ? 'text-rim' : 'text-ink-600'">
                    {{ ranges[i].start }} – {{ ranges[i].end }}
                  </span>
                  <span class="grow" />
                  <button class="btn-ghost px-1.5 py-1" title="Move up" :disabled="i === 0" @click="moveBlock(i, -1)">
                    <ArrowUpIcon class="h-3.5 w-3.5" />
                  </button>
                  <button class="btn-ghost px-1.5 py-1" title="Move down" :disabled="i === blocks.length - 1" @click="moveBlock(i, 1)">
                    <ArrowDownIcon class="h-3.5 w-3.5" />
                  </button>
                  <button class="btn-danger px-1.5 py-1" title="Remove block" @click="removeBlock(i)">
                    <TrashIcon class="h-3.5 w-3.5" />
                  </button>
                </div>

                <div class="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div class="grow">
                    <label class="label" :for="`block-title-${i}`">Title</label>
                    <input :id="`block-title-${i}`" v-model="block.label" class="input" placeholder="e.g. Shell drill" />
                  </div>
                  <div class="sm:w-36">
                    <label class="label" :for="`block-mins-${i}`">Duration (mins)</label>
                    <input :id="`block-mins-${i}`" v-model.number="block.duration_min" type="number" min="1" class="input" />
                  </div>
                </div>

                <div class="mt-2">
                  <label class="label" :for="`block-play-${i}`">Attach drill</label>
                  <div class="flex items-center gap-2">
                    <select :id="`block-play-${i}`" v-model="block.play_id" class="input">
                      <option :value="null">No drill attached</option>
                      <optgroup v-if="playbookPlays.length" label="Playbook">
                        <option v-for="p in playbookPlays" :key="p.id" :value="p.id">{{ p.name }}</option>
                      </optgroup>
                      <optgroup v-if="scoutingPlays.length" label="Scouting">
                        <option v-for="p in scoutingPlays" :key="p.id" :value="p.id">{{ p.name }}</option>
                      </optgroup>
                    </select>
                    <div v-if="diagramFor(block.play_id)" class="pointer-events-none w-16 shrink-0">
                      <CourtCanvas :model-value="diagramFor(block.play_id)!" :editable="false" :total-phases="1" auto-height />
                    </div>
                  </div>
                </div>

                <div class="mt-2">
                  <label class="label" :for="`block-notes-${i}`">Notes</label>
                  <textarea :id="`block-notes-${i}`" v-model="block.notes" rows="2" class="input resize-none" placeholder="Coaching points, teams, emphasis…" />
                </div>
              </div>
            </div>
          </div>
          
          <div class="mb-2 -mt-4 flex items-center justify-end">
            <button class="btn-ghost-outline px-2 py-1 text-xs" @click="addBlock">
              <PlusIcon class="h-4 w-4" /> Add block
            </button>
          </div>

          <!-- plan notes -->
          <div>
            <label class="label" for="plan-notes">Notes (optional)</label>
            <textarea id="plan-notes" v-model="notes" rows="3" class="input resize-none" placeholder="Goals for the session…" />
          </div>

          <!-- motivational quote (printed atop pages 1 and 2) -->
          <div>
            <div class="mb-1 flex items-center justify-between gap-2">
              <label class="label mb-0" for="plan-quote">Quote (optional)</label>
              <button class="btn-ghost px-2 py-0.5 text-[11px]" title="Pick a different quote" @click="regenerateQuote">
                <ArrowPathIcon class="h-3.5 w-3.5" /> New quote
              </button>
            </div>
            <textarea id="plan-quote" v-model="quote" rows="2" class="input resize-none" placeholder="Type your own, or pick one with New quote" />
            <input
              v-model="quoteAuthor"
              class="input mt-2"
              aria-label="Quote author"
              placeholder="Author"
            />
            <p class="mt-1 text-xs text-ink-500">Printed at the top of the first two pages.</p>
          </div>

          <!-- video -->
          <div>
            <span class="label">Attach video (optional)</span>
            <button class="btn-ghost w-full py-2 text-sm" :disabled="busy" @click="fileInput?.click()">
              Choose video…
            </button>
            <input ref="fileInput" type="file" accept="video/*" multiple class="hidden" @change="onPickFiles" />

            <ul v-if="keptVideos.length || stagedFiles.length" class="mt-2 flex flex-col gap-1.5">
              <li
                v-for="v in keptVideos"
                :key="v.id"
                class="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-900/40 px-3 py-1.5 text-xs"
              >
                <span class="truncate">{{ v.title ?? 'Untitled clip' }}</span>
                <span class="ml-auto shrink-0 text-ink-500">attached</span>
                <button class="shrink-0 text-red-400 hover:text-red-300" title="Remove clip" @click="markVideoRemoved(v)">
                  <XMarkIcon class="h-4 w-4" />
                </button>
              </li>
              <li
                v-for="(f, i) in stagedFiles"
                :key="`staged-${i}`"
                class="flex items-center gap-2 rounded-lg border border-rim/40 bg-rim/10 px-3 py-1.5 text-xs"
              >
                <span class="truncate">{{ f.name }}</span>
                <span class="ml-auto shrink-0 text-ink-500">{{ (f.size / 1024 / 1024).toFixed(1) }} MB</span>
                <button class="shrink-0 text-red-400 hover:text-red-300" title="Remove" @click="unstageFile(i)">
                  <XMarkIcon class="h-4 w-4" />
                </button>
              </li>
            </ul>
          </div>

          <p v-if="localError" class="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
            {{ localError }}
          </p>
        </div>

        <!-- actions -->
        <footer class="flex justify-end gap-2 border-t border-ink-700/60 px-5 py-4">
          <button class="btn-ghost" :disabled="busy" @click="emit('close')">Cancel</button>
          <button class="btn-primary" :disabled="busy" @click="onSubmit">
            {{ busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create' }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
