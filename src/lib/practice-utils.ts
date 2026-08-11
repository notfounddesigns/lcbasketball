import type { PracticePlan, PracticePlanItem } from '@/types'

// Plans are keyed on a bare 'YYYY-MM-DD' string. `new Date('2026-08-12')` parses
// as UTC midnight, which renders as the previous day west of Greenwich — so
// build the date from its parts and keep it local.
export function parsePlanDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

export function formatPlanDate(iso: string | null, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return 'No date'
  return parsePlanDate(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...opts,
  })
}

/** What a plan is called in lists and headers: its explicit name, else its date. */
export function planTitle(plan: PracticePlan): string {
  return plan.name?.trim() || formatPlanDate(plan.planned_for)
}

export function blockTitle(item: PracticePlanItem, index: number): string {
  return item.label?.trim() || item.play?.name || `Block ${index + 1}`
}

export function totalMinutes(items: PracticePlanItem[] = []): number {
  return items.reduce((sum, i) => sum + (i.duration_min || 0), 0)
}

export function formatDuration(mins: number): string {
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

/** Minutes elapsed as a clock offset from the start of practice, e.g. "1:05". */
export function formatOffset(mins: number): string {
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`
}

/** Running start/end offset for each block, so a printed plan reads as a timeline. */
export function blockRanges(items: PracticePlanItem[] = []): { start: string; end: string }[] {
  let elapsed = 0
  return items.map((i) => {
    const start = elapsed
    elapsed += i.duration_min || 0
    return { start: formatOffset(start), end: formatOffset(elapsed) }
  })
}
