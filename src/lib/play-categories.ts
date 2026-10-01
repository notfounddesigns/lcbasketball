// The canonical play types, hardcoded client-side for now. Shared by the play
// editor's picklist and the playbook's category landing so the two never drift.
export const PLAY_CATEGORIES = [
  'Man-to-Man',
  'Zone',
  'BLOB',
  'SLOB',
  'Press break',
  'Drill',
] as const

export type PlayCategory = (typeof PLAY_CATEGORIES)[number]

// Heading shown on the playbook's category cards.
export const CATEGORY_LABELS: Record<PlayCategory, string> = {
  'Man-to-Man': 'Man-to-Man Plays',
  Zone: 'Zone Plays',
  BLOB: 'BLOB Plays',
  SLOB: 'SLOB Plays',
  'Press break': 'Press Break Plays',
  Drill: 'Drills',
}

// Values saved under the previous category list that map cleanly onto the
// current one. Anything else falls through to "Other" rather than being guessed.
const LEGACY_ALIASES: Record<string, PlayCategory> = {
  'zone offense': 'Zone',
  'man offense': 'Man-to-Man',
  'man-to-man offense': 'Man-to-Man',
  drills: 'Drill',
}

const CANONICAL_BY_LOWER = new Map<string, PlayCategory>(
  PLAY_CATEGORIES.map((c) => [c.toLowerCase(), c]),
)

// Resolves a stored (free-text) category to a canonical one, or null when it
// doesn't belong to any — empty, or a legacy type with no clear home.
export function resolveCategory(raw: string | null | undefined): PlayCategory | null {
  const key = raw?.trim().toLowerCase()
  if (!key) return null
  return CANONICAL_BY_LOWER.get(key) ?? LEGACY_ALIASES[key] ?? null
}
