// ---------- Court drawing model ----------
// A play diagram is a serializable list of elements drawn on a normalized
// 0..1 coordinate space, so it renders crisply at any size.

export type CourtType = 'full' | 'half'

export type ElementType = 'pen' | 'arrow' | 'marker'

export interface Point {
  x: number // 0..1 normalized to court width
  y: number // 0..1 normalized to court height
}

export interface BaseElement {
  id: string
  type: ElementType
  color: string
  width: number
}

export interface PenElement extends BaseElement {
  type: 'pen'
  points: Point[]
}

export interface ArrowElement extends BaseElement {
  type: 'arrow'
  points: Point[] // first = tail, last = head
  style: 'pass' | 'cut' | 'screen' | 'dribble'
  control?: Point // quadratic bezier control point; absent = straight line
}

export interface MarkerElement extends BaseElement {
  type: 'marker'
  at: Point
  label: string // e.g. "1", "2", "X", "O", "C"
  team: 'home' | 'away' | 'ball'
}

export type DiagramElement = PenElement | ArrowElement | MarkerElement

export interface Diagram {
  courtType: CourtType
  elements: DiagramElement[] // Phase 1 elements
  phases?: DiagramElement[][] // Optional additional phases (index 0 = phase 2, etc.)
}

// ---------- Plays ----------
export interface PlayVideo {
  id: string
  play_id: string
  storage_path: string
  url: string | null // resolved public/signed url for playback
  title: string | null
  created_at: string
}

export interface Play {
  id: string
  name: string
  description: string | null
  category: string | null
  court_type: CourtType
  diagram: Diagram
  is_scouting: boolean
  created_at: string
  updated_at: string
  videos?: PlayVideo[]
  default_preview_mode?: 'diagram' | 'video'
}

export type PlayDraft = Omit<Play, 'id' | 'created_at' | 'updated_at' | 'videos'>

// ---------- Stats ----------
export interface Player {
  id: string
  name: string
  number: number | null
  position: string | null
  active: boolean
}

export interface Game {
  id: string
  opponent: string
  played_on: string // ISO date
  location: string | null
  notes: string | null
  created_at: string
}

// Append-only granular events. A box score is derived by aggregating these.
export type StatType =
  | 'fg_made'
  | 'fg_miss'
  | 'three_made'
  | 'three_miss'
  | 'ft_made'
  | 'ft_miss'
  | 'rebound_off'
  | 'rebound_def'
  | 'assist'
  | 'steal'
  | 'block'
  | 'turnover'
  | 'foul'

export interface StatEvent {
  id: string
  game_id: string
  player_id: string
  stat: StatType
  period: number
  created_at: string
}

// ---------- Shot chart ----------
export interface ShotEvent {
  id: string
  game_id: string
  player_id: string
  x: number // 0..1 normalized court position
  y: number
  made: boolean
  period: number
  created_at: string
}

// ---------- Practice plans ----------
export interface PracticePlanVideo {
  id: string
  plan_id: string
  storage_path: string
  url: string | null // resolved public/signed url for playback
  title: string | null
  created_at: string
}

// A time block within a practice — the ordered unit a plan is built from.
export interface PracticePlanItem {
  id: string
  plan_id: string
  play_id: string | null
  label: string | null
  duration_min: number
  sort_order: number
  notes: string | null
  created_at: string
  play?: { id: string; name: string; diagram: Diagram } | null
}

export interface PracticePlan {
  id: string
  name: string | null // optional; plans are titled by their date
  planned_for: string | null // ISO date
  notes: string | null
  created_at: string
  items?: PracticePlanItem[]
  videos?: PracticePlanVideo[]
}

export interface PracticePlanDraft {
  name: string | null
  planned_for: string | null
  notes: string | null
}

// Editable shape of a time block while the plan form is open — the rows are
// rewritten wholesale on save, so drafts carry no persisted id.
export interface TimeBlockDraft {
  label: string
  duration_min: number
  play_id: string | null
  notes: string
}

// ---------- Substitution log ----------
export interface SubEvent {
  id: string
  game_id: string
  player_id_in: string
  player_id_out: string
  period: number
  created_at: string
}

export interface BoxScoreRow {
  player_id: string
  name: string
  number: number | null
  pts: number
  fgm: number
  fga: number
  tpm: number
  tpa: number
  ftm: number
  fta: number
  oreb: number
  dreb: number
  reb: number
  ast: number
  stl: number
  blk: number
  tov: number
  pf: number
}
