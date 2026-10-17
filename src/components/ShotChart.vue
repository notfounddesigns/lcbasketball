<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useShotChart } from '@/composables/useShotChart'
import { useStats } from '@/composables/useStats'
import type { StatType, ShotEvent, StatEvent } from '@/types'
import { TrashIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import { periodLabel } from '@/lib/stats-utils'
import { HEAT_SCALE, ZONES, zoneDividers, zoneFill, zoneShapes, zoneStats } from '@/lib/shot-zones'

const props = defineProps<{
  // The game whose shots are loaded and recorded; null when the chart shows
  // shots passed in (a season or a scouted team across several games).
  gameId: string | null
  playerId: string | null
  period: number
  // View-only (a finished scouting report): no adding or deleting shots.
  readonly?: boolean
  shotsSource?: ShotEvent[]
  eventsSource?: StatEvent[]
  defaultView?: 'shots' | 'zones'
}>()

const { shots, fetchShots, recordShot, deleteShot } = useShotChart()
const { events, recordStat, deleteStatEvent } = useStats()

const chartShots = computed(() => props.shotsSource ?? shots.value)
const chartEvents = computed(() => props.eventsSource ?? events.value)
const canEdit = computed(() => !props.readonly && !props.shotsSource && !!props.gameId)

// Markers for every shot, or the zone heat map.
const view = ref<'shots' | 'zones'>(props.defaultView ?? 'shots')

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


// Pending shot placement
const pendingShot = ref<{ x: number; y: number } | null>(null)

// Existing shot tapped for deletion
const selectedShotId = ref<string | null>(null)
const selectedShot = computed(() => shots.value.find((s) => s.id === selectedShotId.value) ?? null)

// Which period's shots are overlaid on the chart. The parent owns it so the box
// score can follow the same filter.
// Q1–Q4 and OT always; extra overtimes appear once stats exist in them.
const PERIOD_FILTERS = computed<{ label: string; value: number | 'all' }[]>(() => {
  const last = Math.max(5, props.period, ...chartShots.value.map((s) => s.period), ...chartEvents.value.map((e) => e.period ?? 1))
  return [
    { label: 'All', value: 'all' },
    ...Array.from({ length: last }, (_, i) => ({ label: periodLabel(i + 1), value: i + 1 })),
  ]
})
const periodFilter = defineModel<number | 'all'>('filter', { default: 'all' })

watch(() => props.gameId, (id) => {
  selectedShotId.value = null
  periodFilter.value = 'all'
  if (id && !props.shotsSource) fetchShots(id)
}, { immediate: true })

// ---------- court ↔ element geometry ----------
// The chart's height comes from CSS (a slice of the viewport), so the element
// box almost never matches the 500×470 viewBox. With preserveAspectRatio
// "xMidYMin meet" the court is scaled uniformly to fit, centred across and
// pinned to the top, leaving a letterbox margin on one axis. Element coordinates are therefore a uniform
// scale *plus an offset* — treating them as a straight stretch of the viewBox
// lands the marker further from the tap the further it is from centre.
function fitCourt(boxW: number, boxH: number) {
  const scale = Math.min(boxW / VB_W, boxH / VB_H)
  return {
    scale,
    offsetX: (boxW - VB_W * scale) / 2,
    offsetY: 0, // pinned to the top (xMidYMin)
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

// ---------- zone heat map ----------
const ZONE_SHAPES = zoneShapes()
const ZONE_DIVIDERS = zoneDividers()
const ZONE_LABEL = new Map(ZONES.map((z) => [z.id, z.label]))
const zoneData = computed(() => {
  const stats = zoneStats(displayShots.value)
  const maxAtt = Math.max(0, ...[...stats.values()].map((z) => z.att))
  return ZONE_SHAPES.map((shape) => {
    const stat = stats.get(shape.id)!
    return { ...shape, stat, fill: zoneFill(stat, maxAtt), label: ZONE_LABEL.get(shape.id)! }
  })
})

// The legend sits in the court's bottom-left corner (the backcourt side,
// where shots are rare), wherever the letterboxed court ends up.
const legendPos = computed(() => {
  const { scale, offsetX, offsetY } = fitCourt(svgBox.value.w, svgBox.value.h)
  return { left: `${offsetX + 8}px`, top: `${offsetY + VB_H * scale - 30}px` }
})

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
  chartShots.value.filter((s) =>
    (!props.playerId || s.player_id === props.playerId) &&
    (periodFilter.value === 'all' || s.period === periodFilter.value),
  ),
)

// FG% summary — every shot on the chart is a field goal (free throws are
// recorded with the FT buttons, not on the court).
const fgSummary = computed(() => {
  const made = displayShots.value.filter((s) => s.made).length
  const total = displayShots.value.length
  const pct = total > 0 ? Math.round((made / total) * 100) : 0
  return { made, total, pct }
})

const threeFGSummary = computed(() => {
  const made = only3FGS(displayShots.value.filter((s) => s.made)).length
  const total = only3FGS(displayShots.value).length
  const pct = total > 0 ? Math.round((made / total) * 100) : 0
  return { made, total, pct }
})

// Free throws have no court position, so their line comes from the stat log,
// filtered the same way as the markers (selected player, period).
const ftSummary = computed(() => {
  const fts = chartEvents.value.filter((e) =>
    (e.stat === 'ft_made' || e.stat === 'ft_miss') &&
    (!props.playerId || e.player_id === props.playerId) &&
    (periodFilter.value === 'all' || e.period === periodFilter.value),
  )
  const made = fts.filter((e) => e.stat === 'ft_made').length
  const total = fts.length
  const pct = total > 0 ? Math.round((made / total) * 100) : 0
  return { made, total, pct }
})

function only3FGS(shots: ShotEvent[]): ShotEvent[] {
  return shots.filter(s => {
    return getShotType(s.x, s.y) === 'three'
  })
}

// One pill per shot type; thresholds for the green / amber / red percentage.
const summaryRows = computed(() => [
  { label: 'FG', ...fgSummary.value, good: 40, ok: 30 },
  { label: '3P', ...threeFGSummary.value, good: 30, ok: 20 },
  { label: 'FT', ...ftSummary.value, good: 70, ok: 50 },
])

function pctTone(pct: number, good: number, ok: number) {
  return pct >= good ? 'text-green-400' : pct >= ok ? 'text-orange-400' : 'text-rim'
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

// Classify a court tap as a 2FG or 3FG. Free throws aren't inferred from
// position any more — a jumper from the line is a 2, and FTs have their own
// Made/Miss buttons in the tracker.
function getShotType(nx: number, ny: number): 'two' | 'three' {
  return isThreePointer(nx, ny) ? 'three' : 'two'
}

function statFor(type: 'two' | 'three', made: boolean): StatType {
  if (type === 'three') return made ? 'three_made' : 'three_miss'
  return made ? 'fg_made' : 'fg_miss'
}

const pendingShotType = computed(() =>
  pendingShot.value ? getShotType(pendingShot.value.x, pendingShot.value.y) : null
)

const shotTypeLabel = computed(() => {
  if (pendingShotType.value === 'three') return '3-pointer'
  return '2-pointer'
})

function onCourtClick(e: MouseEvent) {
  if (!canEdit.value) return
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

// True while a shot is being saved — a double tap (or Made then Miss) must not
// record the same shot twice.
const recordingShot = ref(false)

async function confirmShot(made: boolean) {
  if (recordingShot.value) return
  const shot = pendingShot.value
  if (!shot || !props.playerId || !props.gameId) {
    pendingShot.value = null
    return
  }

  // Snapshot everything now: the coach may pick another player or quarter
  // while the inserts are in flight.
  const gameId = props.gameId
  const playerId = props.playerId
  const period = props.period
  const stat = statFor(getShotType(shot.x, shot.y), made)

  recordingShot.value = true
  pendingShot.value = null
  try {
    const saved = await recordShot(gameId, playerId, shot.x, shot.y, made, period)
    if (!saved) return
    // Keep marker and box score in step: drop the marker if its stat fails.
    if (!(await recordStat(gameId, playerId, stat, period))) await deleteShot(saved.id)
  } finally {
    recordingShot.value = false
  }
}

function cancelPending() {
  pendingShot.value = null
}

function onShotClick(shot: ShotEvent) {
  if (!canEdit.value) return
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

// Shape encodes shot type (circle 2PT, diamond 3PT) and fill encodes
// the result (solid = made, hollow = miss), so markers read without color.
function shotPath(shot: ShotEvent): string {
  const cx = shot.x * VB_W
  const cy = shot.y * VB_H
  const type = getShotType(shot.x, shot.y)
  if (type === 'three') {
    const r = 8.5
    return `M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z`
  }
  const r = 6.5
  return `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`
}
</script>

<template>
  <div class="flex flex-col gap-2 w-full shotchart-container lg:w-1/2">
    <!-- Period filter | shooting summary: always one row (scrolls sideways
         rather than wrapping on a narrow phone) -->
    <div class="no-scrollbar flex shrink-0 items-center gap-2 overflow-x-auto whitespace-nowrap text-[11px]">
      <div class="flex shrink-0 items-center gap-1" role="group" aria-label="Period filter">
        <button
          v-for="f in PERIOD_FILTERS"
          :key="f.value"
          class="rounded px-1.5 py-1 font-semibold transition"
          :class="periodFilter === f.value ? 'bg-ink-500 text-chalk' : 'bg-ink-800 text-ink-500 hover:text-chalk'"
          :aria-pressed="periodFilter === f.value"
          @click="periodFilter = f.value; selectedShotId = null"
        >{{ f.label }}</button>
      </div>
      <div class="ml-auto flex shrink-0 items-center gap-1">
        <span
          v-for="row in summaryRows"
          :key="row.label"
          class="inline-flex items-baseline gap-1 rounded-md bg-ink-800 px-1.5 py-1"
        >
          <span class="font-semibold text-ink-500">{{ row.label }}</span>
          <span class="font-mono text-chalk">{{ row.made }}/{{ row.total }}</span>
          <span class="font-mono font-bold" :class="row.total ? pctTone(row.pct, row.good, row.ok) : 'text-ink-600'">
            {{ row.total ? `${row.pct}%` : '—' }}
          </span>
        </span>
      </div>
    </div>

    <!-- Court SVG -->
    <div class="shotchart-court relative w-full">
      <!-- Legend + Shots/Zones toggle, in the court's bottom-left corner -->
      <div
        :style="legendPos"
        class="absolute z-10 flex items-center gap-2.5 rounded-md bg-ink-900/85 py-0.5 pl-0.5 pr-2 text-[11px] text-ink-500"
        :title="!canEdit ? undefined : playerId ? 'Tap the court to add a shot' : 'Select a player to add shots'"
      >
        <span class="flex rounded bg-ink-800 p-0.5" role="group" aria-label="Chart view">
          <button
            v-for="v in (['shots', 'zones'] as const)"
            :key="v"
            class="rounded px-1.5 py-0.5 font-semibold capitalize transition"
            :class="view === v ? 'bg-ink-600 text-chalk' : 'hover:text-chalk'"
            :aria-pressed="view === v"
            @click.stop="view = v; selectedShotId = null; pendingShot = null"
          >{{ v }}</button>
        </span>
        <template v-if="view === 'shots'">
          <span class="inline-flex items-center gap-1"><svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="#16a34a"/></svg>Make</span>
          <span class="inline-flex items-center gap-1"><svg width="10" height="10"><circle cx="5" cy="5" r="3.5" fill="none" stroke="#ef4444" stroke-width="1.5"/></svg>Miss</span>
          <span class="inline-flex items-center gap-1"><svg width="10" height="10"><path d="M5 0.5 L9.5 5 L5 9.5 L0.5 5 Z" fill="#9ca3af"/></svg>3PT</span>
        </template>
        <span
          v-else
          class="inline-flex items-center gap-1"
          title="Colour: make rate against a typical rate for that shot. Shade: share of attempts."
        >
          Cold
          <span v-for="h in HEAT_SCALE" :key="h.color" class="h-2.5 w-3 rounded-sm" :style="{ background: h.color }" />
          Hot
        </span>
      </div>
      <svg
        ref="svgRef"
        :viewBox="`0 0 ${VB_W} ${VB_H}`"
        class="w-full rounded-lg bg-ink-900 shotchart"
        :class="playerId && canEdit ? 'cursor-crosshair' : 'cursor-default'"
        preserveAspectRatio="xMidYMin meet"
        @click="onCourtClick"
      >
        <!-- Zone heat map (under the court lines) -->
        <g v-if="view === 'zones'" pointer-events="none">
          <path
            v-for="z in zoneData"
            :key="z.id"
            :d="z.path"
            :fill="z.fill.color"
            :fill-opacity="z.fill.opacity"
          />
          <line
            v-for="(l, i) in ZONE_DIVIDERS"
            :key="i"
            :x1="l.x1" :y1="l.y1" :x2="l.x2" :y2="l.y2"
            stroke="#374151" stroke-width="1" stroke-dasharray="3 3"
          />
        </g>

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

        <!-- Zone labels: made/attempts and make rate -->
        <g v-if="view === 'zones'" pointer-events="none" font-family="ui-monospace, monospace" text-anchor="middle">
          <template v-for="z in zoneData" :key="z.id">
            <text
              v-if="z.stat.att"
              :x="z.cx" :y="z.cy"
              fill="#f5f5f4" stroke="#0b0b0c" stroke-width="3" paint-order="stroke"
              font-size="15" font-weight="700"
            ><title>{{ z.label }}: {{ z.stat.made }}/{{ z.stat.att }} ({{ z.stat.pct }}%)</title>{{ z.stat.pct }}%</text>
            <text
              v-if="z.stat.att"
              :x="z.cx" :y="z.cy + 14"
              fill="#d6d3d1" stroke="#0b0b0c" stroke-width="3" paint-order="stroke"
              font-size="11"
            >{{ z.stat.made }}/{{ z.stat.att }}</text>
          </template>
        </g>

        <!-- Shot markers -->
        <g
          v-for="shot in (view === 'shots' ? displayShots : [])"
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
            class="rounded bg-green-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-600 active:scale-95 disabled:opacity-50"
            :disabled="recordingShot"
            @click.stop="confirmShot(true)"
          >Made</button>
          <button
            class="rounded bg-red-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 active:scale-95 disabled:opacity-50"
            :disabled="recordingShot"
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
            {{ periodLabel(selectedShot.period) }} · {{ selectedShot.made ? 'Made' : 'Miss' }}
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
