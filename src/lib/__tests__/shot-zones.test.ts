import { describe, expect, it } from 'vitest'
import { VB_H, VB_W, ZONES, zoneAtSvg, zoneFill, zoneOf, zoneShapes, zoneStats } from '@/lib/shot-zones'

// Basket is at (250, 56) in shot-chart SVG units.
describe('zoneAtSvg', () => {
  it.each([
    [250, 70, 'rim'],
    [250, 200, 'paint'],
    [250, 270, 'mid_top'],
    [20, 60, 'c3_l'],
    [480, 60, 'c3_r'],
    [250, 400, 't3'],
    [60, 300, 'w3_l'],
    [440, 300, 'w3_r'],
    [100, 80, 'mid_l_base'],
    [400, 80, 'mid_r_base'],
  ] as const)('(%i, %i) is %s', (x, y, zone) => {
    expect(zoneAtSvg(x, y)).toBe(zone)
  })

  it('maps normalised shot positions onto the same zones', () => {
    expect(zoneOf({ x: 250 / VB_W, y: 70 / VB_H })).toBe('rim')
  })
})

describe('zoneStats', () => {
  it('counts makes and attempts per zone', () => {
    const stats = zoneStats([
      { x: 0.5, y: 70 / VB_H, made: true },
      { x: 0.5, y: 70 / VB_H, made: false },
      { x: 0.5, y: 400 / VB_H, made: true },
    ])
    expect(stats.size).toBe(ZONES.length)
    expect(stats.get('rim')).toMatchObject({ made: 1, att: 2, pct: 50 })
    expect(stats.get('t3')).toMatchObject({ made: 1, att: 1, pct: 100 })
    expect(stats.get('paint')).toMatchObject({ att: 0, pct: 0 })
  })
})

describe('zoneFill', () => {
  it('fades out empty zones and shades by rate against typical', () => {
    expect(zoneFill({ id: 'rim', made: 0, att: 0, pct: 0 }, 5).opacity).toBe(0.03)
    const hot = zoneFill({ id: 't3', made: 5, att: 10, pct: 50 }, 10)
    const cold = zoneFill({ id: 't3', made: 1, att: 10, pct: 10 }, 10)
    expect(hot.color).not.toBe(cold.color)
    expect(hot.opacity).toBe(0.75)
  })
})

describe('zoneShapes', () => {
  it('draws every zone with a centre inside the court', () => {
    const shapes = zoneShapes()
    expect(shapes.map((s) => s.id)).toEqual(ZONES.map((z) => z.id))
    for (const s of shapes) {
      expect(s.path.length).toBeGreaterThan(0)
      expect(s.cx).toBeGreaterThan(0)
      expect(s.cx).toBeLessThan(VB_W)
      expect(s.cy).toBeGreaterThan(0)
      expect(s.cy).toBeLessThan(VB_H)
    }
  })
})
