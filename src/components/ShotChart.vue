<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useShotChart } from '@/composables/useShotChart'
import { useStats } from '@/composables/useStats'
import type { StatType, ShotEvent } from '@/types'

const props = defineProps<{
  gameId: string
  playerId: string | null
  period: number
}>()

const { shots, fetchShots, recordShot } = useShotChart()
const { recordStat } = useStats()

// Court geometry — must match CourtCanvas.vue's half-court (10 SVG units = 1 foot, NFHS)
const VB_W = 500
const VB_H = 470
const BOUNDARY = 6
const BASKET_INSET = 56
const KEY_HALF_W = 80
const KEY_LENGTH = 190
const LANE_ARC_R = 60
const THREE_R = 237
const THREE_CORNER_X = 44
const THREE_ARC_Y_HALF = 182

// Free throw line y in SVG units
const FT_Y_SVG = KEY_LENGTH + BASKET_INSET
const FT_Y_TOLERANCE = 12
const PAINT_HALF_W = KEY_HALF_W + 5

// Pending shot placement
const pendingShot = ref<{ x: number; y: number } | null>(null)

watch(() => props.gameId, (id) => {
  if (id) fetchShots(id)
}, { immediate: true })

// ---------- court ↔ element geometry ----------
// The chart's height comes from CSS (a slice of the viewport), so the element
// box almost never matches the 500×470 viewBox. With preserveAspectRatio
// "xMidYMid meet" the court is scaled uniformly to fit and centred, leaving a
// letterbox margin on one axis. Element coordinates are therefore a uniform
// scale *plus an offset* — treating them as a straight stretch of the viewBox
// lands the marker further from the tap the further it is from centre.
function fitCourt(boxW: number, boxH: number) {
  const scale = Math.min(boxW / VB_W, boxH / VB_H)
  return {
    scale,
    offsetX: (boxW - VB_W * scale) / 2,
    offsetY: (boxH - VB_H * scale) / 2,
  }
}

const svgRef = ref<SVGSVGElement | null>(null)
const svgBox = ref({ w: 0, h: 0 })
let resizeObs: ResizeObserver | null = null

onMounted(() => {
  const el = svgRef.value
  if (!el) return
  resizeObs = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect
    svgBox.value = { w: width, h: height }
  })
  resizeObs.observe(el)
  const rect = el.getBoundingClientRect()
  svgBox.value = { w: rect.width, h: rect.height }
})

onBeforeUnmount(() => resizeObs?.disconnect())

// Where the Made/Miss popup sits, in px within the chart wrapper. Derived from
// the live element size rather than captured at tap time, so it stays anchored
// to the shot through a resize or rotation.
const pendingShotOffset = computed(() => {
  if (!pendingShot.value) return null
  const { scale, offsetX, offsetY } = fitCourt(svgBox.value.w, svgBox.value.h)
  return {
    left: offsetX + pendingShot.value.x * VB_W * scale,
    top: offsetY + pendingShot.value.y * VB_H * scale,
  }
})

// Filter displayed shots by selected player (or show all)
const displayShots = computed<ShotEvent[]>(() => {
  if (!props.playerId) return shots.value
  return shots.value.filter((s) => s.player_id === props.playerId)
})

// FG% summary
const fgSummary = computed(() => {
  const made = only2FGS(displayShots.value.filter((s) => s.made)).length
  const total = only2FGS(displayShots.value).length
  const pct = total > 0 ? Math.round((made / total) * 100) : 0
  return { made, total, pct }
})

const threeFGSummary = computed(() => {
  const made = only3FGS(displayShots.value.filter((s) => s.made)).length
  const total = only3FGS(displayShots.value).length
  const pct = total > 0 ? Math.round((made / total) * 100) : 0
  return { made, total, pct }
})

const ftSummary = computed(() => {
  const made = onlyFTS(displayShots.value.filter((s) => s.made)).length
  const total = onlyFTS(displayShots.value).length
  const pct = total > 0 ? Math.round((made / total) * 100) : 0
  return { made, total, pct }
})

function onlyFTS(shots: ShotEvent[]): ShotEvent[] {
  return shots.filter(s => {
    return getShotType(s.x, s.y) === 'ft'
  })
}

function only2FGS(shots: ShotEvent[]): ShotEvent[] {
  return shots.filter(s => {
    return getShotType(s.x, s.y) !== 'ft'
  })
}

function only3FGS(shots: ShotEvent[]): ShotEvent[] {
  return shots.filter(s => {
    return getShotType(s.x, s.y) === 'three'
  })
}

function svgToNorm(svgX: number, svgY: number) {
  return { x: svgX / VB_W, y: svgY / VB_H }
}

// Determine if a shot is a 3-pointer, using the same geometry as the drawn line.
function isThreePointer(nx: number, ny: number): boolean {
  const svgX = nx * VB_W
  const svgY = ny * VB_H
  // Corner 3: beyond the vertical corner lines
  if (svgX <= THREE_CORNER_X || svgX >= VB_W - THREE_CORNER_X) return true
  // Arc 3: beyond the arc radius measured from the basket
  const dx = svgX - VB_W / 2
  const dy = svgY - BASKET_INSET
  return Math.hypot(dx, dy) > THREE_R
}

// Classify shot as free throw, 2FG, or 3FG
function getShotType(nx: number, ny: number): 'ft' | 'two' | 'three' {
  const svgX = nx * VB_W
  const svgY = ny * VB_H
  // Near the free throw line and within the paint width
  if (
    Math.abs(svgY - FT_Y_SVG) < FT_Y_TOLERANCE &&
    svgX > VB_W / 2 - (PAINT_HALF_W - 40) &&
    svgX < VB_W / 2 + (PAINT_HALF_W - 40)
  ) {
    return 'ft'
  }
  return isThreePointer(nx, ny) ? 'three' : 'two'
}

const pendingShotType = computed(() =>
  pendingShot.value ? getShotType(pendingShot.value.x, pendingShot.value.y) : null
)

const shotTypeLabel = computed(() => {
  if (pendingShotType.value === 'ft') return 'Free Throw'
  if (pendingShotType.value === 'three') return '3-pointer'
  return '2-pointer'
})

function onCourtClick(e: MouseEvent) {
  if (!props.playerId) return // must select a player first
  if (pendingShot.value) {
    pendingShot.value = null
    return
  }

  const svg = (e.currentTarget as SVGElement)
  const rect = svg.getBoundingClientRect()
  const { scale, offsetX, offsetY } = fitCourt(rect.width, rect.height)
  if (!scale) return

  const svgX = (e.clientX - rect.left - offsetX) / scale
  const svgY = (e.clientY - rect.top - offsetY) / scale

  // Taps land in the letterbox margin when the element is wider/taller than the
  // court — those aren't on the floor, so ignore them rather than clamping a
  // shot onto the sideline.
  if (svgX < 0 || svgX > VB_W || svgY < 0 || svgY > VB_H) return

  pendingShot.value = svgToNorm(svgX, svgY)
}

async function confirmShot(made: boolean) {
  if (!pendingShot.value || !props.playerId || !props.gameId) {
    pendingShot.value = null
    return
  }

  const type = getShotType(pendingShot.value.x, pendingShot.value.y)
  let stat: StatType
  if (type === 'ft') stat = made ? 'ft_made' : 'ft_miss'
  else if (type === 'three') stat = made ? 'three_made' : 'three_miss'
  else stat = made ? 'fg_made' : 'fg_miss'

  await recordShot(props.gameId, props.playerId, pendingShot.value.x, pendingShot.value.y, made, props.period)
  await recordStat(props.gameId, props.playerId, stat, props.period)

  pendingShot.value = null
}

function cancelPending() {
  pendingShot.value = null
}
</script>

<template>
  <div class="flex flex-col gap-2 w-full shotchart-container lg:h-full lg:w-1/2">
    <!-- FG% summary bar -->
    <div class="items-center gap-4 text-xs hidden md:flex">
      <div class="flex flex-col gap-1">
        <div class="flex gap-2 w-full">
          <span class="text-ink-500">
            FG:<span class="font-mono text-chalk">{{ fgSummary.made }}/{{ fgSummary.total }}</span>
          </span>
          <span class="text-ink-500 ml-auto">
            FG%:<span class="font-mono font-bold" :class="fgSummary.pct < 40 ? `${fgSummary.pct >= 30 ? 'text-orange-400' : 'text-rim'}` : 'text-green-400'">
              {{ fgSummary.pct }}%
            </span>
          </span>
        </div>
        <div class="flex gap-2 w-full">
          <span class="text-ink-500">
            3FG: <span class="font-mono text-chalk">{{ threeFGSummary.made }}/{{ threeFGSummary.total }}</span>
          </span>
          <span class="text-ink-500 ml-auto">
            3FG%: <span class="font-mono font-bold" :class="threeFGSummary.pct < 30 ? `${threeFGSummary.pct >= 20 ? 'text-orange-400' : 'text-rim'}` : 'text-green-400'">
              {{ threeFGSummary.pct }}%
            </span>
          </span>
        </div>
        <div class="flex gap-2 w-full">
          <span class="text-ink-500">
            FT: <span class="font-mono text-chalk">{{ ftSummary.made }}/{{ ftSummary.total }}</span>
          </span>
          <span class="text-ink-500 ml-auto">
            FT%: <span class="font-mono font-bold" :class="ftSummary.pct < 70 ? `${ftSummary.pct >= 20 ? 'text-orange-400' : 'text-rim'}` : 'text-green-400'">
              {{ ftSummary.pct }}%
            </span>
          </span>
        </div>
      </div>
      <p class="text-center text-xs text-ink-500 mx-auto hidden md:block">
        {{ playerId ? 'Tap court to place a shot' : 'Select a player to record shots' }}
        · {{ displayShots.length }} shot{{ displayShots.length !== 1 ? 's' : '' }}
      </p>
      <span class="ml-auto flex flex-col items-center gap-2 text-ink-500 leading-3">
        <span class="inline-flex items-center gap-1">
          <svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="#16a34a"/></svg>Make
        </span>
        <span class="inline-flex items-center gap-1">
          <svg width="10" height="10">
            <line x1="1" y1="1" x2="9" y2="9" stroke="#ef4444" stroke-width="2"/>
            <line x1="9" y1="1" x2="1" y2="9" stroke="#ef4444" stroke-width="2"/>
          </svg> Miss
        </span>
      </span>
    </div>

    <!-- Court SVG -->
    <div class="relative w-full">
      <svg
        ref="svgRef"
        :viewBox="`0 0 ${VB_W} ${VB_H}`"
        class="w-full rounded-lg bg-ink-900 shotchart"
        :class="playerId ? 'cursor-crosshair' : 'cursor-default'"
        preserveAspectRatio="xMidYMid meet"
        @click="onCourtClick"
      >
        <!-- Court boundary -->
        <rect :x="BOUNDARY" :y="BOUNDARY" :width="VB_W - BOUNDARY * 2" :height="VB_H - BOUNDARY * 2"
          fill="none" stroke="#374151" stroke-width="2" rx="4"/>

        <!-- Paint / Key -->
        <rect :x="VB_W / 2 - KEY_HALF_W" :y="BOUNDARY" :width="KEY_HALF_W * 2"
          :height="KEY_LENGTH + BASKET_INSET - BOUNDARY"
          fill="none" stroke="#374151" stroke-width="1.5"/>
          
        <!-- Paint Outside Lines: Left Side -->
        <rect :x="VB_W / 2 - KEY_HALF_W - 10" :y="BOUNDARY+80" :width="10"
          :height="KEY_LENGTH / 10"
          fill="#374151" stroke="#374151" stroke-width="1.5"/>
        <line :x1="VB_W / 2 - KEY_HALF_W - 10" :y1="BOUNDARY+140" :x2="VB_W / 2 - KEY_HALF_W" :y2="BOUNDARY+140"
          stroke="#374151" stroke-width="3"/>
        <line :x1="VB_W / 2 - KEY_HALF_W - 10" :y1="BOUNDARY+180" :x2="VB_W / 2 - KEY_HALF_W" :y2="BOUNDARY+180"
          stroke="#374151" stroke-width="3"/>

        <!-- Paint Outside Lines: Right Side -->
        <rect :x="VB_W / 2 + KEY_HALF_W" :y="BOUNDARY+80" :width="10"
          :height="KEY_LENGTH / 10"
          fill="#374151" stroke="#374151" stroke-width="1.5"/>
        <line :x1="VB_W / 2 + KEY_HALF_W" :y1="BOUNDARY+140" :x2="VB_W / 2 + KEY_HALF_W + 10" :y2="BOUNDARY+140"
          stroke="#374151" stroke-width="3"/>
        <line :x1="VB_W / 2 + KEY_HALF_W" :y1="BOUNDARY+180" :x2="VB_W / 2 + KEY_HALF_W + 10" :y2="BOUNDARY+180"
          stroke="#374151" stroke-width="3"/>

        <!-- Free throw circle -->
        <circle :cx="VB_W / 2" :cy="KEY_LENGTH + BASKET_INSET - BOUNDARY" :r="LANE_ARC_R"
          fill="none" stroke="#374151" stroke-width="1.5" stroke-dasharray="8 6"/>

        <!-- Basket -->
        <circle :cx="VB_W / 2" :cy="BASKET_INSET" r="9"
          fill="none" stroke="#9ca3af" stroke-width="2"/>
        <!-- Backboard -->
        <line :x1="VB_W / 2 - 30" :y1="BASKET_INSET - 16" :x2="VB_W / 2 + 30" :y2="BASKET_INSET - 16"
          stroke="#9ca3af" stroke-width="3"/>

        <!-- Three-point line: corner lines + arc -->
        <line :x1="THREE_CORNER_X" :y1="BOUNDARY" :x2="THREE_CORNER_X" :y2="THREE_ARC_Y_HALF"
          stroke="#374151" stroke-width="1.5"/>
        <line :x1="VB_W - THREE_CORNER_X" :y1="BOUNDARY" :x2="VB_W - THREE_CORNER_X" :y2="THREE_ARC_Y_HALF"
          stroke="#374151" stroke-width="1.5"/>
        <path
          :d="`M ${THREE_CORNER_X} ${THREE_ARC_Y_HALF} A ${THREE_R} ${THREE_R} 0 0 0 ${VB_W - THREE_CORNER_X} ${THREE_ARC_Y_HALF}`"
          fill="none" stroke="#374151" stroke-width="1.5"/>

        <!-- Restricted area arc -->
        <path
          :d="`M ${VB_W / 2 - 40} ${BASKET_INSET} A 40 40 0 0 0 ${VB_W / 2 + 40} ${BASKET_INSET}`"
          fill="none" stroke="#374151" stroke-width="1" stroke-dasharray="4 3"/>

        <!-- Shot markers -->
        <g v-for="shot in displayShots" :key="shot.id">
          <template v-if="shot.made">
            <circle
              :cx="shot.x * VB_W"
              :cy="shot.y * VB_H"
              r="7"
              fill="#16a34a"
              fill-opacity="0.85"
              stroke="white"
              stroke-width="0.5"
            />
          </template>
          <template v-else>
            <line
              :x1="shot.x * VB_W - 6" :y1="shot.y * VB_H - 6"
              :x2="shot.x * VB_W + 6" :y2="shot.y * VB_H + 6"
              stroke="#ef4444" stroke-width="2.5" stroke-linecap="round"
            />
            <line
              :x1="shot.x * VB_W + 6" :y1="shot.y * VB_H - 6"
              :x2="shot.x * VB_W - 6" :y2="shot.y * VB_H + 6"
              stroke="#ef4444" stroke-width="2.5" stroke-linecap="round"
            />
          </template>
        </g>

        <!-- Pending shot ring -->
        <circle
          v-if="pendingShot"
          :cx="pendingShot.x * VB_W"
          :cy="pendingShot.y * VB_H"
          r="9"
          fill="none"
          stroke="#facc15"
          stroke-width="2"
          stroke-dasharray="4 3"
        />
      </svg>

      <!-- Made / Miss popup near pending shot -->
      <div
        v-if="pendingShot && pendingShotOffset"
        class="absolute z-10"
        :style="{
          left: `${pendingShotOffset.left}px`,
          top: `${pendingShotOffset.top}px`,
          transform: 'translate(-50%, -110%)',
        }"
      >
        <div class="flex items-center gap-1 rounded-lg border border-ink-700 bg-ink-800 p-1.5 shadow-xl">
          <span class="px-1 text-[11px] font-semibold text-ink-400">{{ shotTypeLabel }}</span>
          <button
            class="rounded bg-green-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-600 active:scale-95"
            @click.stop="confirmShot(true)"
          >Made</button>
          <button
            class="rounded bg-red-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 active:scale-95"
            @click.stop="confirmShot(false)"
          >Miss</button>
          <button
            class="rounded px-2 py-1.5 text-xs text-ink-500 hover:text-chalk"
            @click.stop="cancelPending"
          >✕</button>
        </div>
      </div>
    </div>
  </div>
</template>
