<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type {
  ArrowElement,
  CourtType,
  Diagram,
  DiagramElement,
  MarkerElement,
  PenElement,
  Point,
  TextElement,
} from '@/types'
import { PlayIcon } from '@heroicons/vue/24/outline';
import { useConfirm } from '@/composables/useConfirm'
import ToolSpeedDial from '@/components/ToolSpeedDial.vue'

const { confirm } = useConfirm()

// add optional prop for whiteboard view, use pen tool only
// `autoHeight` opts out of the viewport-based height measurement below: the court
// simply fills its container's width at its natural aspect ratio. Use it for
// thumbnails and print sheets, where the surrounding layout dictates the size.
const props = defineProps<{ modelValue: Diagram; editable?: boolean; totalPhases: number; tool?: Tool; autoHeight?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [Diagram], isAnimating: [boolean], exportPng: [] }>()

// 'route' is the transient mode after picking a move (cut/pass/…) from a
// player's menu: the next drag draws that arrow out from the player.
type Tool = 'select' | 'pen' | 'arrow' | 'marker' | 'text' | 'erase' | 'route'
const tool = ref<Tool>(props.tool || 'select')
const color = ref('#000000')
const strokeWidth = ref(2)
const arrowStyle = ref<ArrowElement['style']>('cut')
const markerTeam = ref<MarkerElement['team']>('home')
const markerLabel = ref('1')

// Court geometry constants (10 SVG units = 1 foot, NFHS high school dimensions)
const BOUNDARY = 6
const BASKET_INSET = 56
const KEY_HALF_W = 80
const KEY_LENGTH = 190
const LANE_ARC_R = 60
const THREE_R = 237
const THREE_CORNER_X = 44
const THREE_ARC_Y_HALF = 182
const THREE_ARC_X_FULL = 182

// Intrinsic court geometry in SVG units (10 units = 1 foot). These encode the
// real court's aspect ratio (full 94×50 ft, half 50×47 ft) and must NOT be
// distorted — markings below are drawn relative to W/H.
const dims = computed(() =>
  props.modelValue.courtType === 'full'
    ? { w: 940, h: 500 }
    : { w: 500, h: 470 },
)
const viewBox = computed(() => `0 0 ${dims.value.w} ${dims.value.h}`)
const W = computed(() => dims.value.w)
const H = computed(() => dims.value.h)

// LC brand watermark (centered, subtle). Width in SVG units; aspect ≈ logo's.
const logoUrl = `/LCLogo.png`
const LOGO_ASPECT = 343 / 305
const WATERMARK_W = 150

const svgRef = ref<SVGSVGElement | null>(null)

// ---------- responsive court sizing ----------
// The rendered court fills the container as large as possible while preserving
// its true aspect ratio (contain-fit), clamped to sensible limits so it never
// collapses to nothing or balloons past the point of usefulness.
const MIN_COURT_W = 280 // px — below this markers/labels become unusable
const MAX_COURT_W = 1200 // px — beyond this we only blur the strokes

const containerRef = ref<HTMLElement | null>(null)
const containerSize = ref({ w: 0, h: 0 })
// Height available to the court: the gap from the container's top edge down to
// the fixed bottom nav. Driven by JS so the page never needs to scroll.
const availableHeight = ref(0)

// Fill the room between the container's top edge (below the header/toolbar) and
// the bottom of the viewport, minus the space reserved for the fixed nav. That
// reserved space is the <main> element's bottom padding (pb-28), so accounting
// for it keeps the page from scrolling. Falls back to the nav's own height.
function measureAvailableHeight() {
  const el = containerRef.value
  if (!el || props.autoHeight) return
  // if on route /plays, adjust the available height to be 2/3 of the available height for desktop and 3/4 for mobile, minus 112px
  const animatorDiv = document.getElementById('videoAnimator');
  // Only play cards wrap the court in an <article>; without one there is no card
  // box to measure, so fall through to the viewport calculation.
  const article = el.closest('article')
  if (!animatorDiv && window.location.hash === '#/plays' && article) {
      if (window.innerWidth >= 768) {
        availableHeight.value = (2/3) * article.getBoundingClientRect().height
      } else {
        availableHeight.value = (3/4) * article.getBoundingClientRect().height
      }
  } else {
    const top = el.getBoundingClientRect().top
    const main = el.closest('main')
    const reserved = main
      ? parseFloat(getComputedStyle(main).paddingBottom) || 0
      : (document.querySelector('nav.fixed')?.getBoundingClientRect().height ?? 0)
    availableHeight.value = Math.max(0, window.innerHeight - top - reserved)
  }
}

let resizeObs: ResizeObserver | null = null
onMounted(() => {
  measureAvailableHeight()
  // Re-measure once layout/fonts settle after first paint.
  requestAnimationFrame(measureAvailableHeight)
  const el = containerRef.value
  if (el) {
    resizeObs = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      containerSize.value = { w: width, h: height }
    })
    resizeObs.observe(el)
    containerSize.value = { w: el.clientWidth, h: el.clientHeight }
  }
  window.addEventListener('resize', measureAvailableHeight)
})
onBeforeUnmount(() => {
  resizeObs?.disconnect()
  window.removeEventListener('resize', measureAvailableHeight)
})

// Re-measure when the court type toggles (toolbar/layout above may shift).
watch(dims, () => requestAnimationFrame(measureAvailableHeight))

// Largest box with the court's aspect ratio that fits the container, clamped.
// Null until the container is measured — template falls back to CSS sizing.
const courtSize = computed(() => {
  const aspect = dims.value.w / dims.value.h
  const { w: cw, h: ch } = containerSize.value
  if (!cw || !ch) return null
  const fit = Math.min(cw, ch * aspect) // contain within both axes
  const width = Math.min(Math.max(fit, MIN_COURT_W), MAX_COURT_W, cw)
  return { width, height: width / aspect }
})

// ---------- draw state (pen / arrow tools) ----------
const drawing = ref<DiagramElement | null>(null)
// True while the eraser is being dragged across the canvas
const erasing = ref(false)
// Eraser radius in normalized space — how close a point must be to be rubbed out
const ERASE_R = 0.016
// Cursor position (normalized) for the eraser ring; null when not hovering
const eraserPos = ref<Point | null>(null)

// ---------- select/drag state ----------
const selectedId = ref<string | null>(null)

// Tapping (not dragging) a player opens this menu next to them.
const playerMenu = ref<{ id: string; left: number; top: number } | null>(null)
// Player an in-progress route (cut/pass/dribble/screen) starts from.
const routeFrom = ref<string | null>(null)
// Where a marker drag began, to tell a tap (open the menu) from a move.
let markerDownAt: Point | null = null
const TAP_SLOP = 0.012 // normalized — movement below this is a tap, not a drag

type DragKind = 'marker' | 'text' | 'arrow-tail' | 'arrow-head' | 'arrow-control'
const dragKind = ref<DragKind | null>(null)
// Live copy of element being dragged, rendered instead of committed version
const dragLive = ref<DiagramElement | null>(null)

watch(tool, () => {
  commitTextEdit()
  playerMenu.value = null
  if (tool.value !== 'route') routeFrom.value = null
  selectedId.value = null
  dragKind.value = null
  dragLive.value = null
  if (props.editable) requestAnimationFrame(measureAvailableHeight)
})

// ---------- shared helpers ----------
const elements = computed(() => props.modelValue.elements)

function commit(next: DiagramElement[]) {
  emit('update:modelValue', { ...props.modelValue, elements: next })
}

async function setCourt(type: CourtType) {
  if (props.modelValue.courtType === type) return
  const hasContent =
    elements.value.length > 0 ||
    (props.modelValue.phases?.some((p) => p.length > 0) ?? false)
  if (hasContent) {
    const ok = await confirm({
      title: 'Switch court type',
      message: 'Switching court type will clear all phases. Continue?',
      confirmText: 'Switch',
    })
    if (!ok) return
  }
  emit('update:modelValue', { courtType: type, elements: [] })
}

function toNorm(e: PointerEvent): Point {
  const svg = svgRef.value!
  const rect = svg.getBoundingClientRect()
  return {
    x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
  }
}

function dist(p: Point, q: Point) {
  return Math.hypot(p.x - q.x, p.y - q.y)
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function controlOf(el: ArrowElement): Point {
  return el.control ?? midpoint(el.points[0], el.points[1])
}

// Distance from point to nearest vertex of element (normalized space)
function distToElement(p: Point, el: DiagramElement): number {
  if (el.type === 'marker' || el.type === 'text') return dist(p, el.at)
  const pts = el.type === 'arrow' && el.control
    ? [...el.points, el.control]
    : el.points
  return Math.min(...pts.map((q) => dist(p, q)))
}

// ---------- select tool ----------
const HIT_HANDLE = 0.035  // normalized hit radius for endpoint handles
const HIT_BODY   = 0.030  // normalized hit radius for element body
// Normalized hit radius for player markers — about the dashed selection ring
// (r=23 SVG units on a 500-wide half court). Kept tight so arrow endpoints
// sitting just off a player can still be grabbed.
const HIT_MARKER = 0.035

// ---------- text annotations ----------
const TEXT_FONT = 16 // SVG units
const TEXT_MAX = 40 // characters — keep labels short so they don't swamp the court

// Rough rendered size of a label in SVG units (no DOM measuring needed for hit tests)
function textBox(el: TextElement) {
  const w = Math.max(24, el.text.length * TEXT_FONT * 0.58 + 12)
  const h = TEXT_FONT + 10
  return { w, h }
}

function hitText(p: Point, el: TextElement): boolean {
  const { w, h } = textBox(el)
  return Math.abs(p.x - el.at.x) * W.value < w / 2 && Math.abs(p.y - el.at.y) * H.value < h / 2
}

// Inline editor shown over the court while typing a label
const textEdit = ref<{ id: string | null; at: Point; value: string; left: number; top: number } | null>(null)
const textInputRef = ref<HTMLInputElement | null>(null)

function openTextEditor(at: Point, existing?: TextElement) {
  const svg = svgRef.value
  const container = containerRef.value
  if (!svg || !container) return
  const s = svg.getBoundingClientRect()
  const c = container.getBoundingClientRect()
  textEdit.value = {
    id: existing?.id ?? null,
    at,
    value: existing?.text ?? '',
    left: s.left - c.left + at.x * s.width,
    top: s.top - c.top + at.y * s.height,
  }
  nextTick(() => textInputRef.value?.focus())
}

function commitTextEdit() {
  const edit = textEdit.value
  if (!edit) return
  textEdit.value = null
  const text = edit.value.trim().slice(0, TEXT_MAX)
  if (edit.id) {
    // Editing: blank text removes the label
    commit(text
      ? elements.value.map((el) => (el.id === edit.id && el.type === 'text' ? { ...el, text } : el))
      : elements.value.filter((el) => el.id !== edit.id))
  } else if (text) {
    const el: TextElement = {
      id: crypto.randomUUID(),
      type: 'text',
      color: color.value,
      width: strokeWidth.value,
      at: edit.at,
      text,
    }
    commit([...elements.value, el])
  }
}

function cancelTextEdit() {
  textEdit.value = null
}

let lastTextTap: { id: string; time: number } | null = null

function onSelectDown(e: PointerEvent) {
  const p = toNorm(e)
  const reversed = [...elements.value].reverse()

  // ── priority 0: double-tap a player to give them the ball ──
  // Checked before anything else: the first tap selects the marker, so the
  // second would otherwise be taken as a drag start by the selected-handle check.
  const tappedMarker = reversed.find(
    (el): el is MarkerElement => el.type === 'marker' && dist(p, el.at) < HIT_MARKER,
  )
  if (tappedMarker && isMarkerDoubleTap(tappedMarker, p)) {
    // No drag state on the second tap: pointerup would otherwise commit the
    // stale drag copy over the ball change.
    playerMenu.value = null
    selectedId.value = tappedMarker.id
    giveBallTo(tappedMarker)
    return
  }

  // With the player menu open, a tap anywhere else just closes it.
  if (playerMenu.value) {
    playerMenu.value = null
    return
  }
  markerDownAt = tappedMarker ? p : null

  // Double-tap a text label to edit it
  const tappedText = reversed.find((el): el is TextElement => el.type === 'text' && hitText(p, el))
  if (tappedText) {
    const now = performance.now()
    if (lastTextTap?.id === tappedText.id && now - lastTextTap.time < DOUBLE_TAP_MS) {
      lastTextTap = null
      selectedId.value = tappedText.id
      e.preventDefault()
      openTextEditor(tappedText.at, tappedText)
      return
    }
    lastTextTap = { id: tappedText.id, time: now }
  }

  // ── priority 1: handles of already-selected element ──
  if (selectedId.value) {
    const sel = elements.value.find((el) => el.id === selectedId.value)
    if (sel?.type === 'text' && hitText(p, sel)) {
      dragKind.value = 'text'
      dragLive.value = { ...sel }
      return
    }
    if (sel?.type === 'marker' && dist(p, sel.at) < HIT_MARKER) {
      dragKind.value = 'marker'
      dragLive.value = { ...sel }
      return
    }
    if (sel?.type === 'arrow') {
      if (dist(p, sel.points[0]) < HIT_HANDLE) {
        dragKind.value = 'arrow-tail'
        dragLive.value = { ...sel, points: [...sel.points] }
        return
      }
      if (dist(p, sel.points[1]) < HIT_HANDLE) {
        dragKind.value = 'arrow-head'
        dragLive.value = { ...sel, points: [...sel.points] }
        return
      }
      if (dist(p, controlOf(sel)) < HIT_HANDLE) {
        dragKind.value = 'arrow-control'
        dragLive.value = { ...sel, points: [...sel.points] }
        return
      }
    }
  }

  // ── priority 2: hit-test all elements ──
  // Markers first (rendered on top)
  for (const el of reversed) {
    if (el.type === 'marker' && dist(p, el.at) < HIT_MARKER) {
      selectedId.value = el.id
      dragKind.value = 'marker'
      dragLive.value = { ...el }
      return
    }
  }

  // Text labels
  if (tappedText) {
    selectedId.value = tappedText.id
    dragKind.value = 'text'
    dragLive.value = { ...tappedText }
    return
  }

  // Arrows: endpoint handles or body
  for (const el of reversed) {
    if (el.type !== 'arrow') continue
    if (dist(p, el.points[0]) < HIT_HANDLE) {
      selectedId.value = el.id
      dragKind.value = 'arrow-tail'
      dragLive.value = { ...el, points: [...el.points] }
      return
    }
    if (dist(p, el.points[1]) < HIT_HANDLE) {
      selectedId.value = el.id
      dragKind.value = 'arrow-head'
      dragLive.value = { ...el, points: [...el.points] }
      return
    }
    if (distToElement(p, el) < HIT_BODY) {
      selectedId.value = el.id
      // No immediate drag on body-select — user drags a handle next
      return
    }
  }

  // Miss → deselect
  selectedId.value = null
}

// ---------- double-tap a player to give them the ball ----------
// Detected from pointerdown rather than `dblclick` so it behaves the same for
// mouse, pen and touch (iPad doesn't reliably fire dblclick, and the court
// swallows the double-tap gesture anyway — see onCourtTouchEnd).
const BALL_TAP_SLOP = 0.03 // normalized — how far apart the two taps may land
let lastMarkerTap: { id: string; at: Point; time: number } | null = null

function isMarkerDoubleTap(el: MarkerElement, p: Point): boolean {
  const now = performance.now()
  const prev = lastMarkerTap
  const isDouble = !!prev && prev.id === el.id && now - prev.time < DOUBLE_TAP_MS && dist(prev.at, p) < BALL_TAP_SLOP
  // A completed double-tap resets, so a third tap starts a fresh pair.
  lastMarkerTap = isDouble ? null : { id: el.id, at: p, time: now }
  return isDouble
}

// Exactly one offensive player holds the ball: circle the tapped one and
// un-circle whoever had it. Defenders can't hold the ball, so they're ignored.
function giveBallTo(target: MarkerElement) {
  if (target.team === 'away' || target.team === 'ball') return
  commit(elements.value.map((el) => {
    if (el.type !== 'marker') return el
    if (el.id === target.id) return { ...el, team: 'ball' }
    if (el.team === 'ball') return { ...el, team: 'home' }
    return el
  }))
}

function onSelectMove(e: PointerEvent) {
  if (!dragKind.value || !dragLive.value) return
  const p = toNorm(e)
  const el = dragLive.value
  if ((dragKind.value === 'marker' && el.type === 'marker') || (dragKind.value === 'text' && el.type === 'text')) {
    dragLive.value = { ...el, at: p }
  } else if (dragKind.value === 'arrow-tail' && el.type === 'arrow') {
    dragLive.value = { ...el, points: [p, el.points[1]] }
  } else if (dragKind.value === 'arrow-head' && el.type === 'arrow') {
    dragLive.value = { ...el, points: [el.points[0], p] }
  } else if (dragKind.value === 'arrow-control' && el.type === 'arrow') {
    dragLive.value = { ...el, control: p }
  }
}

function onSelectUp() {
  const live = dragLive.value
  // A marker that was tapped rather than dragged opens its move menu.
  if (dragKind.value === 'marker' && live?.type === 'marker' && markerDownAt && dist(live.at, markerDownAt) < TAP_SLOP) {
    const original = elements.value.find((el): el is MarkerElement => el.id === live.id && el.type === 'marker')
    if (original) openPlayerMenu(original)
  } else if (dragKind.value && live) {
    commit(elements.value.map((el) => (el.id === live.id ? live : el)))
  }
  markerDownAt = null
  dragKind.value = null
  dragLive.value = null
}

// ---------- draw tools ----------
function onDrawDown(e: PointerEvent) {
  const p = toNorm(e)

  if (tool.value === 'route') {
    const from = routeMarker()
    if (!from) {
      tool.value = 'select'
      return
    }
    drawing.value = {
      id: crypto.randomUUID(),
      type: 'arrow',
      color: color.value,
      width: strokeWidth.value,
      points: [routeTail(from.at, p), p],
      style: arrowStyle.value,
    } satisfies ArrowElement
    return
  }

  if (tool.value === 'erase') {
    erasing.value = true
    eraseAt(p)
    return
  }

  if (tool.value === 'marker') {
    commit([...elements.value, {
      id: crypto.randomUUID(),
      type: 'marker',
      color: color.value,
      width: strokeWidth.value,
      at: p,
      label: markerLabel.value || '•',
      team: markerTeam.value,
    } satisfies MarkerElement])
    // Auto-increment numeric label so each successive marker gets the next number
    const num = parseInt(markerLabel.value)
    if (!isNaN(num)) markerLabel.value = String(num + 1)
    // Cap the marker label at 5, then swap to select mode so user can drag the last marker, reset markerLabel to 1 for next time
    if (markerLabel.value === '6') {
      markerLabel.value = '1'
      tool.value = 'select'
    }
    return
  }

  if (tool.value === 'text') {
    // Stop the follow-up mousedown from moving focus off the editor we open
    e.preventDefault()
    // A tap while the editor is open just closes it (keeping what was typed)
    if (textEdit.value) {
      commitTextEdit()
      return
    }
    openTextEditor(p)
    return
  }

  if (tool.value === 'pen') {
    drawing.value = {
      id: crypto.randomUUID(),
      type: 'pen',
      color: color.value,
      width: strokeWidth.value,
      points: [p],
    } satisfies PenElement
  } else if (tool.value === 'arrow') {
    drawing.value = {
      id: crypto.randomUUID(),
      type: 'arrow',
      color: color.value,
      width: strokeWidth.value,
      points: [p, p],
      style: arrowStyle.value,
    } satisfies ArrowElement
  }
}

// Pixel-style eraser: rub out points within ERASE_R of p. Pen strokes are split
// into separate strokes where erased; markers/arrows are removed whole.
function eraseAt(p: Point) {
  let changed = false
  const next: DiagramElement[] = []
  for (const el of elements.value) {
    if (el.type === 'pen') {
      const runs: Point[][] = []
      let run: Point[] = []
      for (const pt of el.points) {
        if (dist(pt, p) < ERASE_R) {
          if (run.length) { runs.push(run); run = [] }
          changed = true
        } else {
          run.push(pt)
        }
      }
      if (run.length) runs.push(run)
      // Untouched stroke: keep as-is to avoid needless churn
      if (runs.length === 1 && runs[0].length === el.points.length) {
        next.push(el)
        continue
      }
      // Re-emit each surviving segment as its own stroke
      for (const r of runs) {
        if (r.length >= 2) next.push({ ...el, id: crypto.randomUUID(), points: r })
      }
    } else if (distToElement(p, el) < ERASE_R) {
      changed = true
    } else {
      next.push(el)
    }
  }
  if (changed) commit(next)
}

// Points closer than this (normalized) are dropped while drawing, so a slow
// Pencil doesn't pile up hundreds of identical samples.
const MIN_POINT_GAP = 0.0015

function onDrawMove(e: PointerEvent) {
  if (tool.value === 'erase') {
    if (erasing.value) eraseAt(toNorm(e))
    return
  }
  if (!drawing.value) return
  const p = toNorm(e)
  if (drawing.value.type === 'pen') {
    // Browsers deliver one pointermove per frame; the Pencil samples far more
    // often. The coalesced events carry the in-between points, so fast strokes
    // stay smooth instead of turning into jagged straight segments.
    const samples = e.getCoalescedEvents?.() ?? []
    const pts = drawing.value.points
    for (const ev of samples.length ? samples : [e]) {
      const q = toNorm(ev)
      const last = pts[pts.length - 1]
      if (!last || dist(last, q) >= MIN_POINT_GAP) pts.push(q)
    }
  } else if (drawing.value.type === 'arrow') {
    // A route keeps its tail on the player's edge, facing the drag.
    const from = tool.value === 'route' ? routeMarker() : null
    drawing.value.points = [from ? routeTail(from.at, p) : drawing.value.points[0], p]
  }
}

function onDrawUp() {
  erasing.value = false
  if (!drawing.value) return
  const el = drawing.value
  drawing.value = null
  // A quick dash or tap — the building block of a hand-drawn dotted line —
  // often produces a single sample. Keep it as a dot instead of throwing it
  // away (a zero-length path with round caps renders as a dot).
  if (el.type === 'pen' && el.points.length === 1) el.points.push({ ...el.points[0] })
  // A route released almost on the player was a mis-tap: drop it, stay ready.
  if (el.type === 'arrow' && dist(el.points[0], el.points[1]) < 0.02) return
  commit([...elements.value, el])
  // Back to select with the new arrow selected so it can be curved right away.
  // Selected after the tool watcher has run, which clears the selection.
  if (el.type === 'arrow') {
    tool.value = 'select'
    nextTick(() => { selectedId.value = el.id })
  }
}

// ---------- player menu: pick a move, then drag it out ----------
const MARKER_R = 16 // SVG units — matches the drawn marker circle

function routeMarker(): MarkerElement | null {
  return elements.value.find((el): el is MarkerElement => el.type === 'marker' && el.id === routeFrom.value) ?? null
}

// Start the arrow just outside the player's circle, on the side facing p.
function routeTail(center: Point, p: Point): Point {
  const dx = (p.x - center.x) * W.value
  const dy = (p.y - center.y) * H.value
  const len = Math.hypot(dx, dy)
  if (len < 1) return center
  const off = (MARKER_R + 4) / len
  return { x: center.x + (dx * off) / W.value, y: center.y + (dy * off) / H.value }
}

const playerMenuRef = ref<HTMLElement | null>(null)
const MENU_GAP = 24 // px between the player and the menu's near edge
const MENU_PAD = 8 // px the menu keeps from the court container's edges

async function openPlayerMenu(m: MarkerElement) {
  const svg = svgRef.value
  const container = containerRef.value
  if (!svg || !container) return
  const s = svg.getBoundingClientRect()
  const c = container.getBoundingClientRect()
  const x = s.left - c.left + m.at.x * s.width
  const y = s.top - c.top + m.at.y * s.height
  selectedId.value = m.id
  playerMenu.value = { id: m.id, left: x + MENU_GAP, top: y }

  // Measure the rendered menu, then keep it inside the court: it opens to the
  // player's right, flips to the left when that would run off the edge (narrow
  // screens), and is clamped vertically so it never hangs over the top/bottom.
  await nextTick()
  const menu = playerMenuRef.value
  if (!menu || playerMenu.value?.id !== m.id) return
  const w = menu.offsetWidth
  const h = menu.offsetHeight
  const maxLeft = c.width - w - MENU_PAD
  const maxTop = c.height - h - MENU_PAD
  let left = x + MENU_GAP
  if (left > maxLeft) left = x - MENU_GAP - w
  playerMenu.value = {
    id: m.id,
    left: Math.max(MENU_PAD, Math.min(left, maxLeft)),
    top: Math.max(MENU_PAD, Math.min(y - h / 2, maxTop)),
  }
}

const ROUTES: { style: ArrowElement['style']; label: string }[] = [
  { style: 'cut', label: 'Cut' },
  { style: 'pass', label: 'Pass' },
  { style: 'dribble', label: 'Dribble' },
  { style: 'screen', label: 'Screen' },
]

function startRoute(style: ArrowElement['style']) {
  if (!playerMenu.value) return
  const id = playerMenu.value.id
  arrowStyle.value = style
  tool.value = 'route'
  routeFrom.value = id
}

const menuMarker = computed(() =>
  elements.value.find((el): el is MarkerElement => el.type === 'marker' && el.id === playerMenu.value?.id) ?? null,
)

function menuGiveBall() {
  if (menuMarker.value) giveBallTo(menuMarker.value)
  playerMenu.value = null
}

function menuDelete() {
  const id = playerMenu.value?.id
  playerMenu.value = null
  if (id) commit(elements.value.filter((el) => el.id !== id))
  selectedId.value = null
}

// Toolbar tools toggle: tapping the active one goes back to select.
function toggleTool(t: Tool) {
  tool.value = tool.value === t ? 'select' : t
}

const drawCursor = computed(() => tool.value === 'pen' || tool.value === 'arrow' || tool.value === 'route')

const routeLabel = computed(() => ROUTES.find((r) => r.style === arrowStyle.value)?.label ?? 'Move')

// ---------- double-tap / double-click suppression ----------
// Drawing a dashed pass line means several short strokes in quick succession in
// roughly the same spot. iPadOS reads two of those as a double-tap and zooms the
// page; desktop browsers fire a text-selecting double-click. Neither is ever
// wanted on the drawing surface — the second tap is just the next stroke, so
// swallow the gesture and let the pointer handlers keep drawing.
const DOUBLE_TAP_MS = 350
let lastTouchEnd = 0

function onCourtTouchEnd(e: TouchEvent) {
  if (!props.editable) return
  const now = performance.now()
  // Cancelling the second touchend of a pair is what actually stops the
  // double-tap zoom; the pointer events that drive drawing have already fired.
  if (now - lastTouchEnd < DOUBLE_TAP_MS) e.preventDefault()
  lastTouchEnd = now
}

function onCourtDoubleClick(e: MouseEvent) {
  if (!props.editable) return
  e.preventDefault()
}

// ---------- router to per-tool handlers ----------
// ---------- one pointer at a time ----------
// Only the pointer that started a gesture may continue or end it. Without this
// a resting palm, or a second finger, starts a new stroke on top of the one in
// progress and the first is lost or cut short.
let activePointerId: number | null = null
// Palm rejection: while the Apple Pencil is in use, touches are ignored, and
// for a moment after it lifts (the hand is still on the glass between dashes).
const PEN_GRACE_MS = 600
let lastPenAt = 0

function acceptsPointer(e: PointerEvent): boolean {
  if (activePointerId !== null) return e.pointerId === activePointerId
  if (e.pointerType === 'pen') return true
  return !(e.pointerType === 'touch' && performance.now() - lastPenAt < PEN_GRACE_MS)
}

function onPointerDown(e: PointerEvent) {
  if (!props.editable || !acceptsPointer(e)) return
  activePointerId = e.pointerId
  if (e.pointerType === 'pen') lastPenAt = performance.now()
  // Capture on the <svg> itself: a child under the finger can be re-rendered
  // mid-stroke, which would silently drop the capture and the pointerup.
  try {
    svgRef.value?.setPointerCapture(e.pointerId)
  } catch {
    // The pointer is already gone (released before this ran) — nothing to capture.
  }
  if (tool.value === 'erase') eraserPos.value = toNorm(e)
  if (tool.value === 'select') onSelectDown(e)
  else onDrawDown(e)
}

function onPointerMove(e: PointerEvent) {
  if (!props.editable) return
  if (activePointerId !== null && e.pointerId !== activePointerId) return
  if (e.pointerType === 'pen') lastPenAt = performance.now()
  if (tool.value === 'erase') eraserPos.value = toNorm(e)
  if (activePointerId === null) return // hover: only the eraser ring follows
  if (tool.value === 'select') onSelectMove(e)
  else onDrawMove(e)
}

function onPointerUp(e?: PointerEvent) {
  if (!props.editable) return
  if (e && activePointerId !== null && e.pointerId !== activePointerId) return
  if (e?.pointerType === 'pen') lastPenAt = performance.now()
  activePointerId = null
  if (tool.value === 'select') onSelectUp()
  else onDrawUp()
}

// The system can cancel a touch mid-gesture (an incoming call, a palm, the
// iPad edge swipe). Drop whatever was in progress rather than committing a
// half-drawn stroke or leaving a drag stuck to the next touch.
function onPointerCancel(e: PointerEvent) {
  if (activePointerId !== null && e.pointerId !== activePointerId) return
  activePointerId = null
  drawing.value = null
  dragKind.value = null
  dragLive.value = null
  erasing.value = false
  eraserPos.value = null
}

// Hide the eraser ring when the pointer leaves the canvas
// Capture is released after every pointerup; if it's lost any other way while
// a gesture is open (the release never arrived), finish the gesture so the
// canvas never stays locked to a pointer that's gone.
function onLostCapture(e: PointerEvent) {
  if (e.pointerId === activePointerId) onPointerUp(e)
}

// With the pointer captured, leave only fires once the gesture has ended, so a
// stroke that drifts past the court edge is no longer cut short.
function onPointerLeave() {
  eraserPos.value = null
}

// Wipes the whole phase, so it asks first (undo only steps back one element).
async function clearAll() {
  if (!elements.value.length) return
  const ok = await confirm({
    title: 'Clear phase',
    message: 'Remove everything drawn in this phase?',
    confirmText: 'Clear',
    tone: 'danger',
  })
  if (!ok) return
  commit([])
  markerLabel.value = '1'
}
function undo() { 
  commit(elements.value.slice(0, -1))
  // decrement marker label if last element was a marker
  const lastElement = elements.value[elements.value.length - 1]
  if (lastElement && lastElement.type === 'marker') {
    const num = parseInt(markerLabel.value)
    if (!isNaN(num)) markerLabel.value = String(num - 1)
  }
}

// ---------- Quick-start templates ----------
type TemplateName = '3out' | '4out' | '4high' |  'horns' | '5out'

const TEMPLATES: Record<TemplateName, { x: number; y: number; label: string; type: 'home' | 'away' | 'ball' }[]> = {
  '3out': [
    { x: 0.50, y: 0.78, label: '1', type: 'ball' },
    { x: 0.12, y: 0.50, label: '2', type: 'home' },
    { x: 0.88, y: 0.50, label: '3', type: 'home' },
    { x: 0.33, y: 0.16, label: '4', type: 'home' },
    { x: 0.67, y: 0.16, label: '5', type: 'home' },
  ],
  '4out': [
    { x: 0.50, y: 0.78, label: '1', type: 'ball' },
    { x: 0.12, y: 0.50, label: '2', type: 'home' },
    { x: 0.88, y: 0.50, label: '3', type: 'home' },
    { x: 0.07, y: 0.16, label: '4', type: 'home' },
    { x: 0.67, y: 0.16, label: '5', type: 'home' },
  ],
  '4high': [
    { x: 0.50, y: 0.78, label: '1', type: 'ball' },
    { x: 0.12, y: 0.50, label: '2', type: 'home' },
    { x: 0.88, y: 0.50, label: '3', type: 'home' },
    { x: 0.33, y: 0.50, label: '4', type: 'home' },
    { x: 0.67, y: 0.50, label: '5', type: 'home' },
  ],
  horns: [
    { x: 0.50, y: 0.78, label: '1', type: 'ball' },
    { x: 0.07, y: 0.16, label: '2', type: 'home' },
    { x: 0.93, y: 0.16, label: '3', type: 'home' },
    { x: 0.33, y: 0.57, label: '4', type: 'home' },
    { x: 0.67, y: 0.57, label: '5', type: 'home' },
  ],
  '5out': [
    { x: 0.50, y: 0.78, label: '1', type: 'ball' },
    { x: 0.12, y: 0.50, label: '2', type: 'home' },
    { x: 0.88, y: 0.50, label: '3', type: 'home' },
    { x: 0.07, y: 0.16, label: '4', type: 'home' },
    { x: 0.93, y: 0.16, label: '5', type: 'home' },
  ]
}

async function applyTemplate(name: TemplateName) {
  if (elements.value.length > 0) {
    const ok = await confirm({
      title: 'Apply template',
      message: 'This will replace existing diagram elements. Continue?',
      confirmText: 'Replace',
    })
    if (!ok) return
  }
  // Templates are laid out for a half court (basket at the top). On a full
  // court, place them in the left half attacking the left basket: distance
  // from the baseline becomes x, and sideline-to-sideline becomes y.
  const full = props.modelValue.courtType === 'full'
  commit(TEMPLATES[name].map((pos) => ({
    id: crypto.randomUUID(),
    type: 'marker' as const,
    color: '#37b6c4',
    width: 3,
    at: full ? { x: (pos.y * 470) / 940, y: pos.x } : { x: pos.x, y: pos.y },
    label: pos.label,
    team: pos.type,
  })))
}

// Apply the chosen template, then reset the select back to its placeholder
function onTemplateSelect(e: Event) {
  const select = e.target as HTMLSelectElement
  const name = select.value as TemplateName
  if (name) applyTemplate(name)
  select.value = ''
}

// ---------- rendering helpers ----------
function penPath(el: PenElement): string {
  return el.points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x * W.value} ${p.y * H.value}`)
    .join(' ')
}

// SVG path for a straight or curved arrow line
function arrowLinePath(el: ArrowElement): string {
  const ax = el.points[0].x * W.value, ay = el.points[0].y * H.value
  const bx = el.points[1].x * W.value, by = el.points[1].y * H.value
  if (el.control) {
    const cx = el.control.x * W.value, cy = el.control.y * H.value
    return `M ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`
  }
  return `M ${ax} ${ay} L ${bx} ${by}`
}

// Dribble zigzag; follows quadratic bezier when a control point is set
function dribblePath(el: ArrowElement): string {
  const ax = el.points[0].x * W.value, ay = el.points[0].y * H.value
  const bx = el.points[1].x * W.value, by = el.points[1].y * H.value
  const amp = 6

  if (!el.control) {
    const len = Math.hypot(bx - ax, by - ay)
    const nx = (by - ay) / (len || 1), ny = -(bx - ax) / (len || 1)
    // Whole number of wave cycles so the wave returns to the line at both ends
    const cycles = Math.max(2, Math.round(len / 32))
    // Subdivide each cycle finely so the polyline reads as a smooth curve
    const segs = cycles * 12
    let d = `M ${ax} ${ay}`
    for (let i = 1; i <= segs; i++) {
      const t = i / segs
      const off = amp * Math.sin(t * cycles * 2 * Math.PI)
      d += ` L ${ax + (bx - ax) * t + nx * off} ${ay + (by - ay) * t + ny * off}`
    }
    return d
  }

  // Curved dribble: smooth sine wave riding the quadratic bezier
  const cx = el.control.x * W.value, cy = el.control.y * H.value
  const approxLen = Math.hypot(cx - ax, cy - ay) + Math.hypot(bx - cx, by - cy)
  // Whole number of wave cycles so the wave returns to the path at both ends
  const cycles = Math.max(2, Math.round(approxLen / 32))
  // Subdivide each cycle finely so the polyline reads as a smooth curve
  const segs = cycles * 12
  let d = `M ${ax} ${ay}`
  for (let i = 1; i <= segs; i++) {
    const t = i / segs, mt = 1 - t
    const px = mt * mt * ax + 2 * t * mt * cx + t * t * bx
    const py = mt * mt * ay + 2 * t * mt * cy + t * t * by
    // Tangent at t for perpendicular offset
    const dtx = 2 * mt * (cx - ax) + 2 * t * (bx - cx)
    const dty = 2 * mt * (cy - ay) + 2 * t * (by - cy)
    const dtLen = Math.hypot(dtx, dty) || 1
    const nx = dty / dtLen, ny = -dtx / dtLen
    const off = amp * Math.sin(t * cycles * 2 * Math.PI)
    d += ` L ${px + nx * off} ${py + ny * off}`
  }
  return d
}

// Arrowhead triangle centered on the head; tip points in the line direction
function arrowHead(el: ArrowElement): string {
  const bx = el.points[1].x * W.value, by = el.points[1].y * H.value
  const from = el.control ?? el.points[0]
  const ax = from.x * W.value, ay = from.y * H.value
  const ang = Math.atan2(by - ay, bx - ax)
  const dx = Math.cos(ang), dy = Math.sin(ang)
  const size = 18
  // Tip is `size` from base; shift so the triangle's centroid sits on (bx, by).
  // Centroid lies size/3 behind the tip along the axis, so push the tip forward by that much.
  const axialLen = size * Math.cos(Math.PI / 6)
  const shift = (2 / 3) * axialLen
  const tx = bx + shift * dx, ty = by + shift * dy
  return [
    `${tx},${ty}`,
    `${tx - size * Math.cos(ang - Math.PI / 6)},${ty - size * Math.sin(ang - Math.PI / 6)}`,
    `${tx - size * Math.cos(ang + Math.PI / 6)},${ty - size * Math.sin(ang + Math.PI / 6)}`,
  ].join(' ')
}

// Screen bar perpendicular to line at the head
function screenBar(el: ArrowElement): { x1: number; y1: number; x2: number; y2: number } {
  const bx = el.points[1].x * W.value, by = el.points[1].y * H.value
  const from = el.control ?? el.points[0]
  const ax = from.x * W.value, ay = from.y * H.value
  const ang = Math.atan2(by - ay, bx - ax)
  const half = 12
  return {
    x1: bx + half * Math.cos(ang + Math.PI / 2),
    y1: by + half * Math.sin(ang + Math.PI / 2),
    x2: bx + half * Math.cos(ang - Math.PI / 2),
    y2: by + half * Math.sin(ang - Math.PI / 2),
  }
}

// All elements to render, substituting live drag copy when dragging
const allElements = computed<DiagramElement[]>(() => {
  const base = drawing.value ? [...elements.value, drawing.value] : [...elements.value]
  if (!dragLive.value) return base
  return base.map((el) => (el.id === dragLive.value!.id ? dragLive.value! : el))
})

const teamColor = { home: '#cc0000', away: '#e8743b', ball: '#e7c993' } as const

// ---------- PNG export ----------
// An SVG drawn through <img> can't load external resources, so the watermark
// has to travel inside the markup as a data URL. Fetched once, then cached.
let logoDataUrl: Promise<string | null> | null = null
function inlineLogo(): Promise<string | null> {
  logoDataUrl ??= fetch(logoUrl)
    .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(r.statusText))))
    .then((blob) => new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    }))
    .catch(() => null) // export still works, just without the watermark
  return logoDataUrl
}

async function exportPng(filename = 'play.png') {
  const svg = svgRef.value
  if (!svg) return
  // Editor chrome (selection ring/handles, eraser ring, open text box) must
  // not end up in the picture.
  commitTextEdit()
  selectedId.value = null
  eraserPos.value = null
  await nextTick()

  const logo = await inlineLogo()
  let svgStr = new XMLSerializer().serializeToString(svg)
  if (logo) svgStr = svgStr.replace(`href="${logoUrl}"`, `href="${logo}"`)

  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const img = new Image()
  const w = svg.clientWidth || 800
  const h = svg.clientHeight || 600
  img.onload = () => {
    const scale = 2
    const canvas = document.createElement('canvas')
    canvas.width = w * scale
    canvas.height = h * scale
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#e7c993' // court-wood (matches tailwind token)
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0, w, h)
    URL.revokeObjectURL(url)
    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = filename
    a.click()
  }
  img.onerror = () => {
    URL.revokeObjectURL(url)
    window.alert('Could not export the diagram as an image.')
  }
  img.src = url
}

defineExpose({ exportPng })
</script>

<template>
  <div :class="editable ? 'flex flex-col gap-2' : ''">
    <!-- ── TOOLBAR (editable only) ── -->
    <!-- Whole-diagram setup. The drawing tools live in the speed dial on the court. -->
    <div v-if="editable" class="flex flex-wrap items-center gap-1.5">
      <button v-if="totalPhases > 1" class="tb-btn" title="Preview animation" aria-label="Preview animation" @click="emit('isAnimating', true)">
        <PlayIcon class="h-5 w-5" />
      </button>
      <select class="input h-[38px] !w-32 py-1.5 text-xs" title="Insert a quick-start formation" @change="onTemplateSelect">
        <option value="" selected>Templates</option>
        <option value="3out">3-Out</option>
        <option value="4out">4-Out</option>
        <option value="4high">4-High</option>
        <option value="horns">Horns</option>
        <option value="5out">5-Out</option>
      </select>
      <div v-if="props.modelValue.elements.length == 0" class="flex overflow-hidden rounded-lg border border-ink-600">
        <button
          v-for="c in (['half', 'full'] as CourtType[])"
          :key="c"
          class="px-3 py-2 text-xs font-semibold capitalize transition"
          :class="modelValue.courtType === c ? 'bg-home text-ink-900' : 'bg-ink-800 text-chalk hover:bg-ink-700'"
          @click="setCourt(c)"
        >{{ c }}</button>
      </div>

      <!-- Marker options while placing players -->
      <template v-if="tool === 'marker'">
        <select v-model="markerTeam" class="input h-[38px] !w-28 py-1.5 text-xs" aria-label="Marker team">
          <option value="home">Offense</option>
          <option value="away">Defense</option>
          <option value="ball">Ball</option>
        </select>
        <input v-model="markerLabel" maxlength="2" class="input h-[38px] !w-14 py-1.5 text-center text-xs" aria-label="Marker label" />
      </template>

    </div>

    <!-- ── COURT ── -->
    <div
      ref="containerRef"
      class="court-surface relative flex w-full items-center justify-center overflow-hidden rounded-lg border border-ink-700 bg-court-wood"
      :style="autoHeight ? {} : { height: `${availableHeight}px` }"
      @touchend="onCourtTouchEnd"
      @dblclick="onCourtDoubleClick"
    >
      <svg
        ref="svgRef"
        :viewBox="viewBox"
        class="block touch-none select-none"
        :style="editable && courtSize
          ? { width: `${courtSize.width}px`, height: `${courtSize.height}px`, cursor: drawCursor ? 'crosshair' : 'default' }
          : { width: '100%', aspectRatio: `${dims.w} / ${dims.h}`, cursor: editable && drawCursor ? 'crosshair' : 'default' }"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointerleave="onPointerLeave"
        @pointercancel="onPointerCancel"
        @lostpointercapture="onLostCapture"
      >
        <!-- court markings -->
        <g fill="none" stroke="#1c1614" stroke-width="2" opacity="0.85">
          <rect :x="BOUNDARY" :y="BOUNDARY" :width="W - BOUNDARY * 2" :height="H - BOUNDARY * 2" />

          <template v-if="modelValue.courtType === 'full'">
            <line :x1="W / 2" :y1="BOUNDARY" :x2="W / 2" :y2="H - BOUNDARY" />
            <circle :cx="W / 2" :cy="H / 2" :r="LANE_ARC_R" />
            <rect :x="BOUNDARY" :y="H / 2 - KEY_HALF_W" :width="KEY_LENGTH + BASKET_INSET - BOUNDARY" :height="KEY_HALF_W * 2" />
            <circle :cx="KEY_LENGTH + BASKET_INSET - BOUNDARY" :cy="H / 2" :r="LANE_ARC_R" />
            <line :x1="BOUNDARY" :y1="H / 2 - (H / 2 - THREE_CORNER_X)" :x2="THREE_ARC_X_FULL" :y2="H / 2 - (H / 2 - THREE_CORNER_X)" />
            <line :x1="BOUNDARY" :y1="H / 2 + (H / 2 - THREE_CORNER_X)" :x2="THREE_ARC_X_FULL" :y2="H / 2 + (H / 2 - THREE_CORNER_X)" />
            <path :d="`M ${THREE_ARC_X_FULL} ${H / 2 - (H / 2 - THREE_CORNER_X)} A ${THREE_R} ${THREE_R} 0 0 1 ${THREE_ARC_X_FULL} ${H / 2 + (H / 2 - THREE_CORNER_X)}`" />
            <circle :cx="BASKET_INSET" :cy="H / 2" r="9" />
            <line :x1="BASKET_INSET - 16" :y1="H / 2 - 30" :x2="BASKET_INSET - 16" :y2="H / 2 + 30" />
            <rect :x="W - KEY_LENGTH - BASKET_INSET + BOUNDARY" :y="H / 2 - KEY_HALF_W" :width="KEY_LENGTH + BASKET_INSET - BOUNDARY" :height="KEY_HALF_W * 2" />
            <circle :cx="W - KEY_LENGTH - BASKET_INSET + BOUNDARY" :cy="H / 2" :r="LANE_ARC_R" />
            <line :x1="W - BOUNDARY" :y1="H / 2 - (H / 2 - THREE_CORNER_X)" :x2="W - THREE_ARC_X_FULL" :y2="H / 2 - (H / 2 - THREE_CORNER_X)" />
            <line :x1="W - BOUNDARY" :y1="H / 2 + (H / 2 - THREE_CORNER_X)" :x2="W - THREE_ARC_X_FULL" :y2="H / 2 + (H / 2 - THREE_CORNER_X)" />
            <path :d="`M ${W - THREE_ARC_X_FULL} ${H / 2 - (H / 2 - THREE_CORNER_X)} A ${THREE_R} ${THREE_R} 0 0 0 ${W - THREE_ARC_X_FULL} ${H / 2 + (H / 2 - THREE_CORNER_X)}`" />
            <circle :cx="W - BASKET_INSET" :cy="H / 2" r="9" />
            <line :x1="W - BASKET_INSET + 16" :y1="H / 2 - 30" :x2="W - BASKET_INSET + 16" :y2="H / 2 + 30" />
          </template>

          <template v-else>
            <rect :x="W / 2 - KEY_HALF_W" :y="BOUNDARY" :width="KEY_HALF_W * 2" :height="KEY_LENGTH + BASKET_INSET - BOUNDARY" />
            <circle :cx="W / 2" :cy="KEY_LENGTH + BASKET_INSET - BOUNDARY" :r="LANE_ARC_R" />
            <line :x1="THREE_CORNER_X" :y1="BOUNDARY" :x2="THREE_CORNER_X" :y2="THREE_ARC_Y_HALF" />
            <line :x1="W - THREE_CORNER_X" :y1="BOUNDARY" :x2="W - THREE_CORNER_X" :y2="THREE_ARC_Y_HALF" />
            <path :d="`M ${THREE_CORNER_X} ${THREE_ARC_Y_HALF} A ${THREE_R} ${THREE_R} 0 0 0 ${W - THREE_CORNER_X} ${THREE_ARC_Y_HALF}`" />
            <circle :cx="W / 2" :cy="BASKET_INSET" r="9" />
            <line :x1="W / 2 - 30" :y1="BASKET_INSET - 16" :x2="W / 2 + 30" :y2="BASKET_INSET - 16" />
          </template>
        </g>

        <!-- LC mark — subtle brand watermark behind diagram elements -->
        <image
          :href="logoUrl"
          :width="WATERMARK_W"
          :height="WATERMARK_W / LOGO_ASPECT"
          :x="W / 2 - WATERMARK_W / 2"
          :y="H / 2 - WATERMARK_W / LOGO_ASPECT / 2 + (modelValue.courtType === 'half' ? 165 : 0)"
          opacity="0.20"
          preserveAspectRatio="xMidYMid meet"
          pointer-events="none"
        />

        <!-- drawn elements -->
        <g v-for="el in allElements" :key="el.id">
          <path
            v-if="el.type === 'pen'"
            :d="penPath(el)"
            fill="none"
            :stroke="el.color"
            :stroke-width="el.width"
            stroke-linecap="round"
            stroke-linejoin="round"
          />

          <template v-else-if="el.type === 'arrow'">
            <!-- dribble wavy line -->
            <path
              v-if="el.style === 'dribble'"
              :d="dribblePath(el)"
              fill="none"
              :stroke="el.color"
              :stroke-width="el.width"
              stroke-linecap="round"
            />
            <!-- all other styles: straight or curved path -->
            <path
              v-else
              :d="arrowLinePath(el)"
              fill="none"
              :stroke="el.color"
              :stroke-width="el.width"
              :stroke-dasharray="el.style === 'pass' ? '10 8' : undefined"
              stroke-linecap="round"
            />
            <!-- arrowhead or screen bar -->
            <polygon
              v-if="el.style !== 'screen'"
              :points="arrowHead(el)"
              :fill="el.color"
            />
            <line
              v-else
              v-bind="screenBar(el)"
              :stroke="el.color"
              :stroke-width="el.width + 1"
              stroke-linecap="round"
            />
          </template>

          <text
            v-else-if="el.type === 'text'"
            :x="el.at.x * W"
            :y="el.at.y * H"
            text-anchor="middle"
            dominant-baseline="central"
            :font-size="TEXT_FONT"
            font-weight="600"
            font-family="Inter, system-ui, sans-serif"
            :fill="el.color"
            stroke="#e7c993"
            stroke-width="4"
            stroke-linejoin="round"
            paint-order="stroke"
          >{{ el.text }}</text>

          <template v-else-if="el.type === 'marker'">
            <circle
              :cx="el.at.x * W"
              :cy="el.at.y * H"
              r="16"
              fill="transparent"
              :stroke="`${el.team === 'ball' ? '#0d0f13' : ''}`"
              stroke-width="2"
            />
            <text
              :x="el.at.x * W"
              :y="el.at.y * H"
              text-anchor="middle"
              dominant-baseline="central"
              font-size="18"
              font-weight="700"
              font-family="Inter, system-ui, sans-serif"
              fill="#000000"
            >
              {{ el.label }}
            </text>
          </template>
        </g>

        <!-- selection handles (select tool only) -->
        <g v-if="editable && tool === 'select' && selectedId">
          <template v-for="el in allElements" :key="el.id + '-sel'">
            <template v-if="el.id === selectedId">
              <!-- marker: dashed ring -->
              <circle
                v-if="el.type === 'marker'"
                :cx="el.at.x * W"
                :cy="el.at.y * H"
                r="23"
                fill="none"
                stroke="white"
                stroke-width="2"
                stroke-dasharray="5 3"
                opacity="0.85"
              />
              <!-- text: dashed box -->
              <rect
                v-else-if="el.type === 'text'"
                :x="el.at.x * W - textBox(el).w / 2"
                :y="el.at.y * H - textBox(el).h / 2"
                :width="textBox(el).w"
                :height="textBox(el).h"
                rx="4"
                fill="none"
                stroke="white"
                stroke-width="2"
                stroke-dasharray="5 3"
                opacity="0.85"
              />
              <!-- arrow: tail, head, and curve-control handles -->
              <template v-else-if="el.type === 'arrow'">
                <!-- guide line to control point -->
                <line
                  :x1="el.points[0].x * W" :y1="el.points[0].y * H"
                  :x2="controlOf(el).x * W" :y2="controlOf(el).y * H"
                  stroke="white" stroke-width="1" stroke-dasharray="3 3" opacity="0.4"
                />
                <line
                  :x1="controlOf(el).x * W" :y1="controlOf(el).y * H"
                  :x2="el.points[1].x * W" :y2="el.points[1].y * H"
                  stroke="white" stroke-width="1" stroke-dasharray="3 3" opacity="0.4"
                />
                <!-- tail handle -->
                <circle
                  :cx="el.points[0].x * W" :cy="el.points[0].y * H"
                  r="9" fill="white" fill-opacity="0.9" stroke="#0d0f13" stroke-width="1.5"
                />
                <!-- head handle -->
                <circle
                  :cx="el.points[1].x * W" :cy="el.points[1].y * H"
                  r="9" fill="white" fill-opacity="0.9" stroke="#0d0f13" stroke-width="1.5"
                />
                <!-- curve control handle (red) -->
                <circle
                  :cx="controlOf(el).x * W" :cy="controlOf(el).y * H"
                  r="9" fill="#cc0000" fill-opacity="0.9" stroke="white" stroke-width="1.5"
                />
              </template>
            </template>
          </template>
        </g>

        <!-- eraser ring: matches the normalized erase radius (ellipse in SVG space) -->
        <ellipse
          v-if="tool === 'erase' && eraserPos"
          :cx="eraserPos.x * W"
          :cy="eraserPos.y * H"
          :rx="ERASE_R * W"
          :ry="ERASE_R * H"
          fill="rgba(255,255,255,0.15)"
          stroke="#0d0f13"
          stroke-width="1.5"
          pointer-events="none"
        />
      </svg>

      <!-- drawing tools; they toggle, so tapping the active one returns to select -->
      <ToolSpeedDial
        v-if="editable"
        :active="tool"
        :can-undo="elements.length > 0"
        @toggle="toggleTool"
        @undo="undo"
        @clear="clearAll"
        @export="emit('exportPng')"
      />

      <!-- move menu for a tapped player -->
      <div
        v-if="playerMenu"
        ref="playerMenuRef"
        class="absolute z-10 flex flex-col overflow-hidden rounded-xl border border-ink-600 bg-ink-900/95 text-sm text-chalk shadow-2xl backdrop-blur"
        :style="{ left: `${playerMenu.left}px`, top: `${playerMenu.top}px` }"
        role="menu"
        @pointerdown.stop
      >
        <button
          v-for="r in ROUTES"
          :key="r.style"
          class="flex items-center gap-3 border-b border-ink-700 px-4 py-2.5 text-left font-semibold hover:bg-ink-700"
          role="menuitem"
          @click="startRoute(r.style)"
        >
          <svg width="28" height="10" viewBox="0 0 28 10" class="shrink-0">
            <path v-if="r.style === 'dribble'" d="M1 5 Q4 0 7 5 T13 5 T19 5 T25 5" fill="none" stroke="currentColor" stroke-width="1.6" />
            <line v-else x1="1" y1="5" x2="25" y2="5" stroke="currentColor" stroke-width="1.8" :stroke-dasharray="r.style === 'pass' ? '4 3' : undefined" />
            <line v-if="r.style === 'screen'" x1="26" y1="0.5" x2="26" y2="9.5" stroke="currentColor" stroke-width="2" />
            <path v-else d="M22 1.5 L27 5 L22 8.5 Z" fill="currentColor" />
          </svg>
          {{ r.label }}
        </button>
        <div class="flex">
          <button
            v-if="menuMarker && menuMarker.team !== 'away'"
            class="flex-1 px-3 py-2 text-xs text-ink-400 hover:bg-ink-700 hover:text-chalk"
            title="Give this player the ball"
            @click="menuGiveBall"
          >Ball</button>
          <button
            class="flex-1 px-3 py-2 text-xs text-red-400 hover:bg-ink-700"
            title="Remove player"
            @click="menuDelete"
          >Delete</button>
        </div>
      </div>

      <!-- route mode hint -->
      <div
        v-if="tool === 'route'"
        class="pointer-events-auto absolute left-1/2 top-2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink-900/90 px-3 py-1.5 text-xs text-chalk shadow-lg"
        @pointerdown.stop
      >
        Drag from the player to where the {{ routeLabel.toLowerCase() }} ends
        <button class="text-ink-400 hover:text-chalk" @click="tool = 'select'">Cancel</button>
      </div>

      <!-- inline text-annotation editor -->
      <input
        v-if="textEdit"
        ref="textInputRef"
        v-model="textEdit.value"
        :maxlength="TEXT_MAX"
        placeholder="Label… (Enter to place)"
        class="absolute z-10 w-44 -translate-x-1/2 -translate-y-1/2 rounded-md border border-ink-600 bg-ink-900/95 px-2 py-1 text-sm text-chalk shadow-xl outline-none focus:border-rim"
        :style="{ left: `${textEdit.left}px`, top: `${textEdit.top}px` }"
        @pointerdown.stop
        @keydown.enter.prevent="commitTextEdit"
        @keydown.esc.prevent="cancelTextEdit"
        @blur="commitTextEdit"
      />
    </div>

  </div>
</template>
