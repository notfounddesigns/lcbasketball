import type { BoxScoreRow, Player, StatEvent } from '@/types'

export interface SeasonRow extends BoxScoreRow {
  gp: number
  ppg: number
  rpg: number
  apg: number
  fg_pct: number
  three_pct: number
  ft_pct: number
}

function emptyRow(p: Player): BoxScoreRow {
  return {
    player_id: p.id,
    name: p.name,
    number: p.number,
    pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0,
    oreb: 0, dreb: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0,
  }
}

export function buildBoxScore(roster: Player[], evts: StatEvent[]): BoxScoreRow[] {
  const rows = new Map<string, BoxScoreRow>()
  for (const p of roster) rows.set(p.id, emptyRow(p))

  for (const e of evts) {
    const row = rows.get(e.player_id)
    if (!row) continue
    switch (e.stat) {
      case 'fg_made': row.fgm++; row.fga++; row.pts += 2; break
      case 'fg_miss': row.fga++; break
      case 'three_made': row.tpm++; row.tpa++; row.fgm++; row.fga++; row.pts += 3; break
      case 'three_miss': row.tpa++; row.fga++; break
      case 'ft_made': row.ftm++; row.fta++; row.pts += 1; break
      case 'ft_miss': row.fta++; break
      case 'rebound_off': row.oreb++; row.reb++; break
      case 'rebound_def': row.dreb++; row.reb++; break
      case 'assist': row.ast++; break
      case 'steal': row.stl++; break
      case 'block': row.blk++; break
      case 'turnover': row.tov++; break
      case 'foul': row.pf++; break
    }
  }
  return [...rows.values()]
}

export function buildSeasonStats(roster: Player[], evts: StatEvent[]): SeasonRow[] {
  const base = buildBoxScore(roster, evts)
  // Count unique game_ids per player
  const gpMap = new Map<string, Set<string>>()
  for (const e of evts) {
    if (!gpMap.has(e.player_id)) gpMap.set(e.player_id, new Set())
    gpMap.get(e.player_id)!.add(e.game_id)
  }
  return base.map((r) => {
    const gp = gpMap.get(r.player_id)?.size ?? 0
    const div = gp || 1
    return {
      ...r,
      gp,
      ppg: Math.round((r.pts / div) * 10) / 10,
      rpg: Math.round((r.reb / div) * 10) / 10,
      apg: Math.round((r.ast / div) * 10) / 10,
      fg_pct: r.fga ? Math.round((r.fgm / r.fga) * 1000) / 10 : 0,
      three_pct: r.tpa ? Math.round((r.tpm / r.tpa) * 1000) / 10 : 0,
      ft_pct: r.fta ? Math.round((r.ftm / r.fta) * 1000) / 10 : 0,
    }
  })
}

export function boxScoreToCsv(rows: BoxScoreRow[], gameLabel: string): string {
  const header = [
    'Game', 'No', 'Player', 'PTS', 'FGM', 'FGA', '3PM', '3PA', 'FTM', 'FTA',
    'OREB', 'DREB', 'REB', 'AST', 'STL', 'BLK', 'TOV', 'PF',
  ]
  const lines = rows.map((r) =>
    [
      gameLabel, r.number ?? '', r.name, r.pts, r.fgm, r.fga, r.tpm, r.tpa,
      r.ftm, r.fta, r.oreb, r.dreb, r.reb, r.ast, r.stl, r.blk, r.tov, r.pf,
    ]
      .map((v) => (typeof v === 'string' && v.includes(',') ? `"${v}"` : v))
      .join(','),
  )
  return [header.join(','), ...lines].join('\n')
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
