import { describe, expect, it } from 'vitest'
import type { Player, StatEvent, StatType } from '@/types'
import {
  boxScoreToCsv,
  buildBoxScore,
  buildSeasonStats,
  formatPct,
  periodLabel,
  seasonStatsToCsv,
  teamTotals,
} from '@/lib/stats-utils'

const roster: Player[] = [
  { id: 'p1', name: 'Ava', number: 3, position: 'G', active: true },
  { id: 'p2', name: 'Smith, Jo', number: null, position: null, active: true },
]

let seq = 0
function ev(player_id: string, stat: StatType, game_id = 'g1', period = 1): StatEvent {
  return { id: `e${++seq}`, game_id, player_id, stat, period, created_at: '' }
}

describe('buildBoxScore', () => {
  it('starts every roster player at zero', () => {
    const rows = buildBoxScore(roster, [])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ player_id: 'p1', name: 'Ava', number: 3, pts: 0, fga: 0, reb: 0 })
  })

  it('counts shots, points and the rest of the line', () => {
    const [row] = buildBoxScore(roster, [
      ev('p1', 'fg_made'),
      ev('p1', 'fg_miss'),
      ev('p1', 'three_made'),
      ev('p1', 'three_miss'),
      ev('p1', 'ft_made'),
      ev('p1', 'ft_miss'),
      ev('p1', 'rebound_off'),
      ev('p1', 'rebound_def'),
      ev('p1', 'assist'),
      ev('p1', 'steal'),
      ev('p1', 'block'),
      ev('p1', 'turnover'),
      ev('p1', 'foul'),
    ])
    expect(row).toMatchObject({
      pts: 6,
      fgm: 2, fga: 4,
      tpm: 1, tpa: 2,
      ftm: 1, fta: 2,
      oreb: 1, dreb: 1, reb: 2,
      ast: 1, stl: 1, blk: 1, tov: 1, pf: 1,
    })
  })

  it('ignores events for players not on the roster', () => {
    const rows = buildBoxScore(roster, [ev('ghost', 'fg_made')])
    expect(rows.every((r) => r.pts === 0)).toBe(true)
    expect(rows.map((r) => r.player_id)).toEqual(['p1', 'p2'])
  })
})

describe('buildSeasonStats', () => {
  it('averages over the games each player appeared in', () => {
    const rows = buildSeasonStats(roster, [
      ev('p1', 'three_made', 'g1'),
      ev('p1', 'fg_made', 'g2'),
      ev('p1', 'fg_miss', 'g2'),
      ev('p1', 'rebound_def', 'g2'),
    ])
    const ava = rows.find((r) => r.player_id === 'p1')!
    expect(ava.gp).toBe(2)
    expect(ava.ppg).toBe(2.5)
    expect(ava.rpg).toBe(0.5)
    expect(ava.fg_pct).toBe(66.7)
    expect(ava.three_pct).toBe(100)
    expect(ava.ft_pct).toBe(0)
  })

  it('gives a player with no events zero games and zero averages', () => {
    const jo = buildSeasonStats(roster, []).find((r) => r.player_id === 'p2')!
    expect(jo).toMatchObject({ gp: 0, ppg: 0, fg_pct: 0 })
  })
})

describe('teamTotals', () => {
  it('sums every counting stat', () => {
    const rows = buildBoxScore(roster, [ev('p1', 'fg_made'), ev('p2', 'three_made'), ev('p2', 'assist')])
    expect(teamTotals(rows)).toMatchObject({ player_id: 'team', name: 'Team', pts: 5, fgm: 2, fga: 2, tpm: 1, ast: 1 })
  })
})

describe('CSV export', () => {
  it('quotes values containing commas and blanks a missing number', () => {
    const csv = boxScoreToCsv(buildBoxScore(roster, []), 'vs Hatton')
    const lines = csv.split('\n')
    expect(lines[0].startsWith('Game,No,Player,PTS')).toBe(true)
    expect(lines[2].startsWith('vs Hatton,,"Smith, Jo",0')).toBe(true)
  })

  it('writes one season line per player with one-decimal percentages', () => {
    const csv = seasonStatsToCsv(buildSeasonStats(roster, [ev('p1', 'fg_made'), ev('p1', 'fg_miss'), ev('p1', 'fg_miss')]))
    const lines = csv.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[1].split(',').slice(0, 8)).toEqual(['3', 'Ava', '1', '2', '2', '1', '3', '33.3'])
  })
})

describe('periodLabel', () => {
  it('labels quarters and numbered overtimes', () => {
    expect([1, 4, 5, 6, 7].map(periodLabel)).toEqual(['Q1', 'Q4', 'OT', 'OT2', 'OT3'])
  })
})

describe('formatPct', () => {
  it('rounds to one decimal and dashes out zero attempts', () => {
    expect(formatPct(1, 3)).toBe('33.3%')
    expect(formatPct(0, 0)).toBe('—')
  })
})
