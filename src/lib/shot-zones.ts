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
  const three = x <= THREE_CORNER_X || x >= VB_W - THREE_CORNER_X || dist > THREE_R
  if (three) {
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
// Each zone is rasterised once into a single SVG path of horizontal runs on a
// fine grid: exact enough to read at any chart size, and no polygon maths for
// the arc/ray intersections.
const STEP = 2

export interface ZoneShape { id: ZoneId; path: string; cx: number; cy: number }

function buildShapes(): ZoneShape[] {
  const parts = new Map<ZoneId, string[]>()
  const sums = new Map<ZoneId, { x: number; y: number; n: number }>()
  for (const z of ZONES) {
    parts.set(z.id, [])
    sums.set(z.id, { x: 0, y: 0, n: 0 })
  }
  for (let y = 0; y < VB_H; y += STEP) {
    let runStart = 0
    let runZone = zoneAtSvg(STEP / 2, y + STEP / 2)
    for (let x = STEP; x <= VB_W; x += STEP) {
      const zone = x < VB_W ? zoneAtSvg(x + STEP / 2, y + STEP / 2) : null
      if (zone === runZone) continue
      parts.get(runZone)!.push(`M${runStart} ${y}h${x - runStart}v${STEP}h${runStart - x}z`)
      const s = sums.get(runZone)!
      const cells = (x - runStart) / STEP
      s.x += ((runStart + x) / 2) * cells
      s.y += (y + STEP / 2) * cells
      s.n += cells
      runStart = x
      if (zone) runZone = zone
    }
  }
  return ZONES.map((z) => {
    const s = sums.get(z.id)!
    return { id: z.id, path: parts.get(z.id)!.join(''), cx: s.x / s.n, cy: s.y / s.n }
  })
}

let shapes: ZoneShape[] | null = null
export function zoneShapes(): ZoneShape[] {
  return (shapes ??= buildShapes())
}

// Boundary lines between zones that the court markings don't already draw
// (the paint, arc and restricted area are on the court itself).
export function zoneDividers(): { x1: number; y1: number; x2: number; y2: number }[] {
  const ray = (deg: number, r: number) => ({
    x: BASKET_X + r * Math.sin((deg * Math.PI) / 180),
    y: BASKET_Y + r * Math.cos((deg * Math.PI) / 180),
  })
  const outsidePaint = (p: { x: number; y: number }) =>
    Math.abs(p.x - BASKET_X) > PAINT_HALF_W || p.y > PAINT_DEPTH
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = []
  for (const deg of [-MID_WING, -MID_TOP, MID_TOP, MID_WING]) {
    let r = RIM_R
    while (!outsidePaint(ray(deg, r)) && r < THREE_R) r += 1
    const a = ray(deg, r)
    const b = ray(deg, THREE_R)
    lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })
  }
  for (const deg of [-THREE_TOP, THREE_TOP]) {
    const a = ray(deg, THREE_R)
    const b = ray(deg, 400)
    lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })
  }
  // Corner threes end where the arc starts.
  lines.push({ x1: 6, y1: THREE_ARC_Y, x2: THREE_CORNER_X, y2: THREE_ARC_Y })
  lines.push({ x1: VB_W - THREE_CORNER_X, y1: THREE_ARC_Y, x2: VB_W - 6, y2: THREE_ARC_Y })
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
  return { color, opacity: 0.25 + 0.5 * Math.min(1, stat.att / Math.max(1, maxAtt)) }
}
