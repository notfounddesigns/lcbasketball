// The canonical play types, hardcoded client-side for now. Shared by the play
// editor's picklist and the playbook's quick filter so the two never drift.
export const PLAY_CATEGORIES = [
  'Half-court set',
  'BLOB',
  'SLOB',
  'Press break',
  'Fast break',
  'Motion offense',
  'Zone offense',
  'End-of-game',
  'Special situation',
] as const

export type PlayCategory = (typeof PLAY_CATEGORIES)[number]
