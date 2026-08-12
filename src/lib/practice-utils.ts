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

export function totalMinutes(items: { duration_min: number }[] = []): number {
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

/**
 * Wall-clock times travel as 'HH:MM' from <input type="time"> and 'HH:MM:SS'
 * from Postgres `time` — both parse to minutes since midnight.
 */
export function parseTimeOfDay(value: string | null | undefined): number | null {
  if (!value) return null
  const [h, m] = value.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m
}

/** What an <input type="time"> wants: 'HH:MM', seconds trimmed off. */
export function toTimeInput(value: string | null | undefined): string {
  return value ? value.slice(0, 5) : ''
}

/** 'HH:MM' plus some minutes, back in the shape an <input type="time"> takes. */
export function addMinutesToTime(value: string | null | undefined, mins: number): string | null {
  const base = parseTimeOfDay(value)
  if (base === null) return null
  const wrapped = (((base + mins) % 1440) + 1440) % 1440
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`
}

/** Minutes since midnight → "4:05 PM" in the viewer's locale, wrapping past midnight. */
export function formatTimeOfDay(mins: number): string {
  const wrapped = ((mins % 1440) + 1440) % 1440
  return new Date(2000, 0, 1, 0, wrapped).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** "4:00 PM – 6:00 PM" for a plan's scheduled window, or null if it has no start. */
export function formatTimeWindow(start: string | null, end: string | null): string | null {
  const s = parseTimeOfDay(start)
  if (s === null) return null
  const e = parseTimeOfDay(end)
  return e === null ? formatTimeOfDay(s) : `${formatTimeOfDay(s)} – ${formatTimeOfDay(e)}`
}

/** Length of the scheduled window, treating an end at or before the start as the next day. */
export function windowMinutes(start: string | null, end: string | null): number | null {
  const s = parseTimeOfDay(start)
  const e = parseTimeOfDay(end)
  if (s === null || e === null) return null
  const diff = e - s
  return diff >= 0 ? diff : diff + 1440
}

/**
 * Running start/end for each block, so a plan reads as a timeline. With a start
 * time the blocks land on the clock ("4:00 PM – 4:15 PM"); without one they fall
 * back to offsets from zero, which is all a plan saved before start times has.
 */
export function blockRanges(
  items: { duration_min: number }[] = [],
  startTime?: string | null,
): { start: string; end: string }[] {
  const startOfDay = parseTimeOfDay(startTime)
  const label = startOfDay === null
    ? formatOffset
    : (mins: number) => formatTimeOfDay(startOfDay + mins)

  let elapsed = 0
  return items.map((i) => {
    const start = elapsed
    elapsed += i.duration_min || 0
    return { start: label(start), end: label(elapsed) }
  })
}
