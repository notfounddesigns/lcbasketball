<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useShotChart } from '@/composables/useShotChart'
import { useStats } from '@/composables/useStats'
import type { StatType, ShotEvent } from '@/types'
import { TrashIcon, XMarkIcon } from '@heroicons/vue/24/outline'

const props = defineProps<{
  gameId: string
  playerId: string | null
  period: number
}>()

const { shots, fetchShots, recordShot, deleteShot } = useShotChart()
const { events, recordStat, deleteStatEvent } = useStats()

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

// Existing shot tapped for deletion
const selectedShotId = ref<string | null>(null)
const selectedShot = computed(() => shots.value.find((s) => s.id === selectedShotId.value) ?? null)

// Which period's shots are overlaid on the chart
const PERIOD_FILTERS: { label: string; value: number | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Q1', value: 1 },
  { label: 'Q2', value: 2 },
  { label: 'Q3', value: 3 },
  { label: 'Q4', value: 4 },
  { label: 'OT', value: 5 },
]
const periodFilter = ref<number | 'all'>('all')

watch(() => props.gameId, (id) => {
  selectedShotId.value = null
  periodFilter.value = 'all'
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
function popupOffset(pt: { x: number; y: number } | null) {
  if (!pt) return null
  const { scale, offsetX, offsetY } = fitCourt(svgBox.value.w, svgBox.value.h)
  return {
    left: offsetX + pt.x * VB_W * scale,
    top: offsetY + pt.y * VB_H * scale,
  }
}

const pendingShotOffset = computed(() => popupOffset(pendingShot.value))
const selectedShotOffset = computed(() => popupOffset(selectedShot.value))

// Filter displayed shots by selected player and period (or show all)
const displayShots = computed<ShotEvent[]>(() =>
  shots.value.filter((s) =>
    (!props.playerId || s.player_id === props.playerId) &&
    (periodFilter.value === 'all' || s.period === periodFilter.value),
  ),
)

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

function statFor(type: 'ft' | 'two' | 'three', made: boolean): StatType {
  if (type === 'ft') return made ? 'ft_made' : 'ft_miss'
  if (type === 'three') return made ? 'three_made' : 'three_miss'
  return made ? 'fg_made' : 'fg_miss'
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
  if (selectedShotId.value) {
    selectedShotId.value = null
    return
  }
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

  const stat = statFor(getShotType(pendingShot.value.x, pendingShot.value.y), made)

  await recordShot(props.gameId, props.playerId, pendingShot.value.x, pendingShot.value.y, made, props.period)
  await recordStat(props.gameId, props.playerId, stat, props.period)

  pendingShot.value = null
}

function cancelPending() {
  pendingShot.value = null
}

function onShotClick(shot: ShotEvent) {
  pendingShot.value = null
  selectedShotId.value = selectedShotId.value === shot.id ? null : shot.id
}

// Every shot was recorded alongside a shooting stat_event; remove that one too
// so the box score stays in sync. Shots and stats aren't linked by id, so pair
// on player + stat + period and take the event logged closest in time.
async function deleteSelectedShot() {
  const shot = selectedShot.value
  if (!shot) return
  const stat = statFor(getShotType(shot.x, shot.y), shot.made)
  const shotTime = Date.parse(shot.created_at)
  const paired = events.value
    .filter((e) => e.player_id === shot.player_id && e.stat === stat && e.period === shot.period)
    .sort((a, b) => Math.abs(Date.parse(a.created_at) - shotTime) - Math.abs(Date.parse(b.created_at) - shotTime))[0]

  if (await deleteShot(shot.id)) {
    if (paired) await deleteStatEvent(paired.id)
  }
  selectedShotId.value = null
}

// Shape encodes shot type (circle 2PT, diamond 3PT, square FT) and fill encodes
// the result (solid = made, hollow = miss), so markers read without color.
function shotPath(shot: ShotEvent): string {
  const cx = shot.x * VB_W
  const cy = shot.y * VB_H
  const type = getShotType(shot.x, shot.y)
  if (type === 'three') {
    const r = 8.5
    return `M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z`
  }
  if (type === 'ft') {
    const h = 6
    return `M ${cx - h} ${cy - h} H ${cx + h} V ${cy + h} H ${cx - h} Z`
  }
  const r = 6.5
  return `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`
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
      <span class="ml-auto grid grid-cols-2 items-center gap-x-3 gap-y-2 text-ink-500 leading-3">
        <span class="inline-flex items-center gap-1">
          <svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="#16a34a"/></svg>Make
        </span>
        <span class="inline-flex items-center gap-1">
          <svg width="10" height="10"><circle cx="5" cy="5" r="3.5" fill="none" stroke="#ef4444" stroke-width="1.5"/></svg>Miss
        </span>
        <span class="inline-flex items-center gap-1">
          <svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="#9ca3af"/></svg>2PT
        </span>
        <span class="inline-flex items-center gap-1">
          <svg width="10" height="10"><path d="M5 0.5 L9.5 5 L5 9.5 L0.5 5 Z" fill="#9ca3af"/></svg>3PT
        </span>
        <span class="inline-flex items-center gap-1">
          <svg width="10" height="10"><rect x="1" y="1" width="8" height="8" fill="#9ca3af"/></svg>FT
        </span>
      </span>
    </div>

    <!-- Period filter -->
    <div class="flex items-center gap-1">
      <span class="mr-1 text-[11px] text-ink-500">Show</span>
      <button
        v-for="f in PERIOD_FILTERS"
        :key="f.value"
        class="rounded px-2 py-0.5 text-[11px] font-semibold transition"
        :class="periodFilter === f.value ? 'bg-ink-500 text-chalk' : 'bg-ink-800 text-ink-500 hover:text-chalk'"
        @click="periodFilter = f.value; selectedShotId = null"
      >{{ f.label }}</button>
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
        <g
          v-for="shot in displayShots"
          :key="shot.id"
          class="cursor-pointer"
          @click.stop="onShotClick(shot)"
        >
          <!-- Larger invisible hit target so markers are easy to tap -->
          <circle :cx="shot.x * VB_W" :cy="shot.y * VB_H" r="13" fill="transparent" />
          <path
            :d="shotPath(shot)"
            :fill="shot.made ? '#16a34a' : 'none'"
            :fill-opacity="shot.made ? 0.85 : undefined"
            :stroke="shot.made ? 'white' : '#ef4444'"
            :stroke-width="shot.made ? 0.5 : 2.5"
          />
          <circle
            v-if="selectedShotId === shot.id"
            :cx="shot.x * VB_W"
            :cy="shot.y * VB_H"
            r="13"
            fill="none"
            stroke="#facc15"
            stroke-width="2"
          />
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
            class="rounded p-1.5 text-ink-500 hover:text-chalk"
            title="Cancel" aria-label="Cancel"
            @click.stop="cancelPending"
          ><XMarkIcon class="h-4 w-4" /></button>
        </div>
      </div>

      <!-- Delete popup for a tapped shot marker -->
      <div
        v-if="selectedShot && selectedShotOffset"
        class="absolute z-10"
        :style="{
          left: `${selectedShotOffset.left}px`,
          top: `${selectedShotOffset.top}px`,
          transform: 'translate(-50%, -125%)',
        }"
      >
        <div class="flex items-center gap-1 rounded-lg border border-ink-700 bg-ink-800 p-1.5 shadow-xl">
          <span class="px-1 text-[11px] font-semibold text-ink-400">
            {{ selectedShot.period > 4 ? 'OT' : `Q${selectedShot.period}` }} · {{ selectedShot.made ? 'Made' : 'Miss' }}
          </span>
          <button
            class="rounded bg-red-800 p-1.5 text-white hover:bg-red-700 active:scale-95"
            title="Delete shot" aria-label="Delete shot"
            @click.stop="deleteSelectedShot"
          ><TrashIcon class="h-4 w-4" /></button>
          <button
            class="rounded p-1.5 text-ink-500 hover:text-chalk"
            title="Cancel" aria-label="Cancel"
            @click.stop="selectedShotId = null"
          ><XMarkIcon class="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  </div>
</template>
