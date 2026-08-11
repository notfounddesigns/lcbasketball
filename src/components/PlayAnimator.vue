<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import type { Diagram, PlayVideo } from '@/types'
import CourtCanvas from './CourtCanvas.vue'

const props = defineProps<{ name: string; diagram: Diagram; videos?: PlayVideo[]; default_preview_mode?: 'diagram' | 'video' }>()
const emit = defineEmits<{ close: [] }>()

const totalPhases = computed(() => 1 + (props.diagram.phases?.length ?? 0))
const currentPhase = ref(0)
const playing = ref(totalPhases.value > 1)

// Only clips that have a resolved playback URL are usable
const playableVideos = computed(() => props.videos?.filter((v) => v.url) ?? [])
const hasVideo = computed(() => playableVideos.value.length > 0)

// 'diagram' = animated court; 'video' = mp4 playback
type Mode = 'diagram' | 'video'
const mode = ref<Mode>(props.default_preview_mode ?? (hasVideo.value ? 'video' : 'diagram'))
const currentVideo = ref(0)
const activeVideo = computed(() => playableVideos.value[currentVideo.value] ?? null)

const displayDiagram = computed<Diagram>(() => {
  if (currentPhase.value === 0) return props.diagram
  return {
    ...props.diagram,
    elements: props.diagram.phases?.[currentPhase.value - 1] ?? [],
  }
})

let timer: ReturnType<typeof setInterval> | null = null

function startTimer() {
  stopTimer()
  if (totalPhases.value <= 1 || mode.value !== 'diagram') return
  timer = setInterval(() => {
    currentPhase.value = (currentPhase.value + 1) % totalPhases.value
  }, 1800)
}

function stopTimer() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

function togglePlay() {
  playing.value = !playing.value
  if (playing.value) startTimer()
  else stopTimer()
}

function prev() {
  playing.value = false
  stopTimer()
  currentPhase.value = (currentPhase.value - 1 + totalPhases.value) % totalPhases.value
}

function next() {
  playing.value = false
  stopTimer()
  currentPhase.value = (currentPhase.value + 1) % totalPhases.value
}

function jumpTo(i: number) {
  playing.value = false
  stopTimer()
  currentPhase.value = i
}

function setMode(m: Mode) {
  mode.value = m
  // Pause the phase animation while watching video; resume when back to diagram
  if (m === 'video') stopTimer()
  else if (playing.value) startTimer()
}

watch(playing, (v) => { if (v) startTimer(); else stopTimer() }, { immediate: true })

onUnmounted(stopTimer)
</script>

<template>
  <Teleport to="body">
    <div id="videoAnimator" class="fixed inset-0 z-50 flex flex-col bg-black/96 p-4 backdrop-blur-sm">
      <!-- header -->
      <div class="mb-4 flex items-center gap-3">
        <button class="btn-ghost py-1.5 text-sm" @click="emit('close')">← Close</button>
        <h2 class="grow truncate font-stencil text-lg font-bold">{{ name }}</h2>
        <span v-if="mode === 'diagram'" class="shrink-0 text-sm text-ink-400">
          Phase {{ currentPhase + 1 }} / {{ totalPhases }}
        </span>
      </div>

      <!-- diagram / video mode toggle (only when a clip exists) -->
      <div v-if="hasVideo" class="mb-3 flex justify-center">
        <div class="flex gap-1 rounded-2xl bg-ink-800 p-1">
          <button
            v-for="m in (['diagram', 'video'] as Mode[])"
            :key="m"
            class="rounded-xl px-5 py-1.5 text-sm font-semibold capitalize transition"
            :class="mode === m ? 'bg-ink-600 text-chalk shadow-sm' : 'text-ink-400 hover:text-chalk'"
            @click="setMode(m)"
          >{{ m }}</button>
        </div>
      </div>

      <!-- stage -->
      <div class="flex min-h-0 flex-1 justify-center">
        <div v-if="mode === 'diagram'" class="w-full max-w-2xl">
          <CourtCanvas            
            :model-value="displayDiagram"
            :total-phases="totalPhases"
          />
        </div>
        <div v-else-if="activeVideo" class="w-full max-w-2xl lg:max-w-[75dvw]">
          <video
            :key="activeVideo.id"
            :src="activeVideo.url!"
            controls
            :muted="true"
            autoplay
            playsinline
            class="w-full rounded-lg bg-black"
          />
        </div>
      </div>

      <!-- diagram controls -->
      <template v-if="mode === 'diagram'">
        <div class="mt-4 flex items-center justify-center gap-4">
          <button class="btn-ghost px-5 py-2" :disabled="totalPhases <= 1" @click="prev">← Prev</button>
          <button class="btn-primary px-8 py-2" :disabled="totalPhases <= 1" @click="togglePlay">
            {{ playing ? 'Pause' : 'Play' }}
          </button>
          <button class="btn-ghost px-5 py-2" :disabled="totalPhases <= 1" @click="next">Next →</button>
        </div>

        <!-- phase dots -->
        <div v-if="totalPhases > 1" class="mt-3 flex justify-center gap-2">
          <button
            v-for="i in totalPhases"
            :key="i"
            :class="[
              'h-2 rounded-full transition-all duration-300',
              currentPhase === i - 1 ? 'w-6 bg-rim' : 'w-2 bg-ink-600 hover:bg-ink-400',
            ]"
            @click="jumpTo(i - 1)"
          />
        </div>
      </template>

      <!-- video clip selector (when more than one clip) -->
      <div v-else-if="playableVideos.length > 1" class="mt-4 flex flex-wrap justify-center gap-2">
        <button
          v-for="(v, i) in playableVideos"
          :key="v.id"
          class="max-w-[12rem] truncate rounded-lg px-4 py-1.5 text-sm font-semibold transition"
          :class="currentVideo === i ? 'bg-rim text-ink-900' : 'bg-ink-800 text-chalk hover:bg-ink-700'"
          @click="currentVideo = i"
        >{{ v.title ?? `Clip ${i + 1}` }}</button>
      </div>
    </div>
  </Teleport>
</template>
