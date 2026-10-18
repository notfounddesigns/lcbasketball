import type { ShotEvent } from '@/types'

// Shot-zone heat map: the half court split into the zones coaches chart
// (rim, paint, five mid-range spots, corner/wing/top threes). Geometry is in
// the shot chart's SVG units and must match ShotChart.vue (10 units = 1 foot).
export const VB_W = 500
export const VB_H = 470
const BASKET_X = VB_W / 2
const BASKET_Y = 56
const RIM_R = 40 // restricted-area radius
const PAINT_HALF_W = 80
const PAINT_DEPTH = 246 // baseline to free-throw line
const THREE_R = 237
const THREE_CORNER_X = 44
const THREE_ARC_Y = 182
const BOUNDARY = 6
// The drawn three-point arc runs from the bottom of one corner line to the
// other, so its centre sits a little below the basket.
const THREE_CY = THREE_ARC_Y - Math.sqrt(THREE_R ** 2 - (BASKET_X - THREE_CORNER_X) ** 2)

/** Inside the three-point line, exactly as it's drawn on the chart (SVG units). */
function insideArc(x: number, y: number) {
  if (x <= THREE_CORNER_X || x >= VB_W - THREE_CORNER_X) return false
  return y <= THREE_ARC_Y || Math.hypot(x - BASKET_X, y - THREE_CY) <= THREE_R
}

/** Whether a shot at this normalised (0..1) position is a three. */
export function isThreeAt(nx: number, ny: number): boolean {
  return !insideArc(nx * VB_W, ny * VB_H)
}

export type ZoneId =
  | 'rim' | 'paint'
  | 'mid_l_base' | 'mid_l_wing' | 'mid_top' | 'mid_r_wing' | 'mid_r_base'
  | 'c3_l' | 'w3_l' | 't3' | 'w3_r' | 'c3_r'

type ZoneKind = 'rim' | 'paint' | 'mid' | 'three'

export const ZONES: { id: ZoneId; label: string; kind: ZoneKind }[] = [
  { id: 'rim', label: 'At the rim', kind: 'rim' },
  { id: 'paint', label: 'Paint', kind: 'paint' },
  { id: 'mid_l_base', label: 'Left baseline 2', kind: 'mid' },
  { id: 'mid_l_wing', label: 'Left elbow 2', kind: 'mid' },
  { id: 'mid_top', label: 'Top-of-key 2', kind: 'mid' },
  { id: 'mid_r_wing', label: 'Right elbow 2', kind: 'mid' },
  { id: 'mid_r_base', label: 'Right baseline 2', kind: 'mid' },
  { id: 'c3_l', label: 'Left corner 3', kind: 'three' },
  { id: 'w3_l', label: 'Left wing 3', kind: 'three' },
  { id: 't3', label: 'Top 3', kind: 'three' },
  { id: 'w3_r', label: 'Right wing 3', kind: 'three' },
  { id: 'c3_r', label: 'Right corner 3', kind: 'three' },
]

// A typical high-school make rate per kind of shot; zones are coloured hot or
// cold against these rather than against one number for every distance.
const TYPICAL_PCT: Record<ZoneKind, number> = { rim: 55, paint: 42, mid: 36, three: 30 }

// Angles from the basket, in degrees: 0 is straight out toward half court,
// negative is the coach's left (x < centre), ±90 is along the baseline.
const MID_TOP = 20
const MID_WING = 55
const THREE_TOP = 22

function angleFromBasket(x: number, y: number) {
  return (Math.atan2(x - BASKET_X, y - BASKET_Y) * 180) / Math.PI
}

/** Which zone a point (SVG units) falls in. */
export function zoneAtSvg(x: number, y: number): ZoneId {
  const dist = Math.hypot(x - BASKET_X, y - BASKET_Y)
  const a = angleFromBasket(x, y)
  if (!insideArc(x, y)) {
    if (y <= THREE_ARC_Y && x <= THREE_CORNER_X) return 'c3_l'
    if (y <= THREE_ARC_Y && x >= VB_W - THREE_CORNER_X) return 'c3_r'
    return a < -THREE_TOP ? 'w3_l' : a > THREE_TOP ? 'w3_r' : 't3'
  }
  if (dist <= RIM_R) return 'rim'
  if (Math.abs(x - BASKET_X) <= PAINT_HALF_W && y <= PAINT_DEPTH) return 'paint'
  if (a < -MID_WING) return 'mid_l_base'
  if (a < -MID_TOP) return 'mid_l_wing'
  if (a <= MID_TOP) return 'mid_top'
  if (a <= MID_WING) return 'mid_r_wing'
  return 'mid_r_base'
}

/** Which zone a shot (normalised 0..1 position) falls in. */
export function zoneOf(shot: Pick<ShotEvent, 'x' | 'y'>): ZoneId {
  return zoneAtSvg(shot.x * VB_W, shot.y * VB_H)
}

// ---------- drawable zone shapes ----------
// Zones are drawn as vector shapes so their edges are as smooth as the court
// lines. Mid-range and three-point zones are wedges from the basket, cut to the
// right area by a mask (see ShotChart): 'mid' keeps inside the arc minus the
// paint, 'three' keeps outside the arc minus the corners. The whole layer is
// clipped to the court.
export type ZoneMask = 'mid' | 'three' | null

export interface ZoneShape {
  id: ZoneId
  path: string
  mask: ZoneMask
  evenOdd?: boolean
  cx: number // label position
  cy: number
}

const fmt = (n: number) => Math.round(n * 100) / 100

function wedge(fromDeg: number, toDeg: number): string {
  const R = 900 // far past the court; the clip trims it
  const pts: string[] = [`M${BASKET_X} ${BASKET_Y}`]
  for (let d = fromDeg; d < toDeg; d += 15) pts.push(pointAt(d, R))
  pts.push(pointAt(toDeg, R))
  return pts.join('L') + 'Z'
}
function pointAt(deg: number, r: number) {
  const rad = (deg * Math.PI) / 180
  return `${fmt(BASKET_X + r * Math.sin(rad))} ${fmt(BASKET_Y + r * Math.cos(rad))}`
}
const rect = (x: number, y: number, w: number, h: number) => `M${x} ${y}h${w}v${h}h${-w}Z`
const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`

/** The court inside its boundary line. */
export const COURT_PATH = rect(BOUNDARY, BOUNDARY, VB_W - 2 * BOUNDARY, VB_H - 2 * BOUNDARY)
/** Everything inside the three-point line. */
export const ARC_PATH =
  `M${THREE_CORNER_X} ${BOUNDARY}V${THREE_ARC_Y}` +
  `A${THREE_R} ${THREE_R} 0 0 0 ${VB_W - THREE_CORNER_X} ${THREE_ARC_Y}V${BOUNDARY}Z`
export const PAINT_PATH = rect(BASKET_X - PAINT_HALF_W, BOUNDARY, PAINT_HALF_W * 2, PAINT_DEPTH - BOUNDARY)
/** The two corner-three boxes (outside the corner lines, below the arc's start). */
export const CORNERS_PATH =
  rect(0, 0, THREE_CORNER_X, THREE_ARC_Y) + rect(VB_W - THREE_CORNER_X, 0, THREE_CORNER_X, THREE_ARC_Y)

const SHAPE_PATHS: Record<ZoneId, { path: string; mask: ZoneMask; evenOdd?: boolean }> = {
  rim: { path: circle(BASKET_X, BASKET_Y, RIM_R), mask: null },
  paint: { path: PAINT_PATH + circle(BASKET_X, BASKET_Y, RIM_R), mask: null, evenOdd: true },
  mid_l_base: { path: wedge(-180, -MID_WING), mask: 'mid' },
  mid_l_wing: { path: wedge(-MID_WING, -MID_TOP), mask: 'mid' },
  mid_top: { path: wedge(-MID_TOP, MID_TOP), mask: 'mid' },
  mid_r_wing: { path: wedge(MID_TOP, MID_WING), mask: 'mid' },
  mid_r_base: { path: wedge(MID_WING, 180), mask: 'mid' },
  c3_l: { path: rect(0, 0, THREE_CORNER_X, THREE_ARC_Y), mask: null },
  w3_l: { path: wedge(-180, -THREE_TOP), mask: 'three' },
  t3: { path: wedge(-THREE_TOP, THREE_TOP), mask: 'three' },
  w3_r: { path: wedge(THREE_TOP, 180), mask: 'three' },
  c3_r: { path: rect(VB_W - THREE_CORNER_X, 0, THREE_CORNER_X, THREE_ARC_Y), mask: null },
}

// Label positions: the centre of each zone's in-court area, found by sampling.
function centroids(): Map<ZoneId, { cx: number; cy: number }> {
  const sums = new Map<ZoneId, { x: number; y: number; n: number }>(ZONES.map((z) => [z.id, { x: 0, y: 0, n: 0 }]))
  const STEP = 4
  for (let y = BOUNDARY + STEP / 2; y < VB_H - BOUNDARY; y += STEP) {
    for (let x = BOUNDARY + STEP / 2; x < VB_W - BOUNDARY; x += STEP) {
      const s = sums.get(zoneAtSvg(x, y))!
      s.x += x
      s.y += y
      s.n++
    }
  }
  return new Map([...sums].map(([id, s]) => [id, { cx: s.x / s.n, cy: s.y / s.n }]))
}

let shapes: ZoneShape[] | null = null
export function zoneShapes(): ZoneShape[] {
  if (!shapes) {
    const c = centroids()
    shapes = ZONES.map((z) => ({ id: z.id, ...SHAPE_PATHS[z.id], ...c.get(z.id)! }))
  }
  return shapes
}

// Boundary lines between zones that the court markings don't already draw
// (the paint, arc and restricted area are on the court itself).
export function zoneDividers(): { x1: number; y1: number; x2: number; y2: number }[] {
  const ray = (deg: number, r: number) => ({
    x: BASKET_X + r * Math.sin((deg * Math.PI) / 180),
    y: BASKET_Y + r * Math.cos((deg * Math.PI) / 180),
  })
  const inPaint = (p: { x: number; y: number }) =>
    Math.abs(p.x - BASKET_X) <= PAINT_HALF_W && p.y <= PAINT_DEPTH
  const inCourt = (p: { x: number; y: number }) =>
    p.x >= BOUNDARY && p.x <= VB_W - BOUNDARY && p.y >= BOUNDARY && p.y <= VB_H - BOUNDARY
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = []
  for (const deg of [-MID_WING, -MID_TOP, MID_TOP, MID_WING]) {
    let r = RIM_R
    while (inPaint(ray(deg, r))) r += 0.5
    const a = ray(deg, r)
    while (insideArc(ray(deg, r).x, ray(deg, r).y)) r += 0.5
    const b = ray(deg, r)
    lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })
  }
  for (const deg of [-THREE_TOP, THREE_TOP]) {
    let r = THREE_R - 20
    while (insideArc(ray(deg, r).x, ray(deg, r).y)) r += 0.5
    const a = ray(deg, r)
    while (inCourt(ray(deg, r))) r += 0.5
    const b = ray(deg, r - 0.5)
    lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })
  }
  // Corner threes end where the arc starts.
  lines.push({ x1: BOUNDARY, y1: THREE_ARC_Y, x2: THREE_CORNER_X, y2: THREE_ARC_Y })
  lines.push({ x1: VB_W - THREE_CORNER_X, y1: THREE_ARC_Y, x2: VB_W - BOUNDARY, y2: THREE_ARC_Y })
  return lines
}

// ---------- stats + colour ----------
export interface ZoneStat { id: ZoneId; made: number; att: number; pct: number }

export function zoneStats(shots: Pick<ShotEvent, 'x' | 'y' | 'made'>[]): Map<ZoneId, ZoneStat> {
  const out = new Map<ZoneId, ZoneStat>(ZONES.map((z) => [z.id, { id: z.id, made: 0, att: 0, pct: 0 }]))
  for (const s of shots) {
    const z = out.get(zoneOf(s))!
    z.att++
    if (s.made) z.made++
  }
  for (const z of out.values()) z.pct = z.att ? Math.round((z.made / z.att) * 100) : 0
  return out
}

const KIND = new Map(ZONES.map((z) => [z.id, z.kind]))

export const HEAT_SCALE = [
  { color: '#2563eb', label: 'Cold' },
  { color: '#60a5fa', label: '' },
  { color: '#f97316', label: '' },
  { color: '#ef4444', label: 'Hot' },
]

/** Fill colour (make rate vs. typical for that kind of shot) and opacity (share of attempts). */
export function zoneFill(stat: ZoneStat, maxAtt: number): { color: string; opacity: number } {
  if (!stat.att) return { color: '#ffffff', opacity: 0.03 }
  const delta = stat.pct - TYPICAL_PCT[KIND.get(stat.id)!]
  const color = delta >= 8 ? HEAT_SCALE[3].color : delta >= 0 ? HEAT_SCALE[2].color : delta >= -8 ? HEAT_SCALE[1].color : HEAT_SCALE[0].color
  return { color, opacity: 0.6 * Math.min(1, stat.att / Math.max(1, maxAtt)) }
}
