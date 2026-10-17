import { describe, expect, it } from 'vitest'
import type { PracticePlan, PracticePlanItem } from '@/types'
import {
  addMinutesToTime,
  blockRanges,
  blockTitle,
  formatDuration,
  formatOffset,
  parsePlanDate,
  parseTimeOfDay,
  planTitle,
  toTimeInput,
  totalMinutes,
  windowMinutes,
} from '@/lib/practice-utils'

describe('parsePlanDate', () => {
  it('keeps the calendar day in local time', () => {
    const d = parsePlanDate('2026-08-12')
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 7, 12])
  })
})

describe('titles', () => {
  it('prefers a plan name and falls back to its date', () => {
    expect(planTitle({ name: '  Walkthrough ', planned_for: '2026-08-12' } as PracticePlan)).toBe('Walkthrough')
    expect(planTitle({ name: null, planned_for: null } as unknown as PracticePlan)).toBe('No date')
  })

  it('names a block by label, then drill, then position', () => {
    expect(blockTitle({ label: 'Warmup' } as PracticePlanItem, 0)).toBe('Warmup')
    expect(blockTitle({ label: ' ', play: { name: 'Horns' } } as PracticePlanItem, 0)).toBe('Horns')
    expect(blockTitle({ label: null } as PracticePlanItem, 2)).toBe('Block 3')
  })
})

describe('durations', () => {
  it('totals minutes, treating missing durations as zero', () => {
    expect(totalMinutes([{ duration_min: 10 }, { duration_min: 0 }, { duration_min: 15 }])).toBe(25)
    expect(totalMinutes()).toBe(0)
  })

  it('formats minutes and hours', () => {
    expect(formatDuration(45)).toBe('45 min')
    expect(formatDuration(60)).toBe('1h')
    expect(formatDuration(95)).toBe('1h 35m')
    expect(formatOffset(65)).toBe('1:05')
  })
})

describe('time of day', () => {
  it('parses input and Postgres times', () => {
    expect(parseTimeOfDay('16:05')).toBe(965)
    expect(parseTimeOfDay('16:05:00')).toBe(965)
    expect(parseTimeOfDay('')).toBeNull()
    expect(parseTimeOfDay('nope')).toBeNull()
    expect(toTimeInput('16:05:00')).toBe('16:05')
  })

  it('adds minutes and wraps past midnight', () => {
    expect(addMinutesToTime('16:00', 90)).toBe('17:30')
    expect(addMinutesToTime('23:30', 45)).toBe('00:15')
    expect(addMinutesToTime(null, 10)).toBeNull()
  })

  it('measures a window, rolling an early end into the next day', () => {
    expect(windowMinutes('16:00', '18:00')).toBe(120)
    expect(windowMinutes('23:00', '01:00')).toBe(120)
    expect(windowMinutes('16:00', null)).toBeNull()
  })
})

describe('blockRanges', () => {
  it('falls back to offsets without a start time', () => {
    expect(blockRanges([{ duration_min: 10 }, { duration_min: 65 }])).toEqual([
      { start: '0:00', end: '0:10' },
      { start: '0:10', end: '1:15' },
    ])
  })

  it('lands blocks on the clock with a start time', () => {
    const ranges = blockRanges([{ duration_min: 15 }, { duration_min: 15 }], '16:00')
    expect(ranges).toHaveLength(2)
    expect(ranges[0].start).toMatch(/4:00/)
    expect(ranges[1].end).toMatch(/4:30/)
  })
})
