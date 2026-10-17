import { describe, expect, it } from 'vitest'
import type { Diagram, MarkerElement } from '@/types'
import { diagramPhases } from '@/lib/diagram-utils'

const marker = (id: string): MarkerElement => ({
  id, type: 'marker', color: '#fff', width: 2, at: { x: 0.5, y: 0.5 }, label: '1', team: 'home',
})

describe('diagramPhases', () => {
  it('returns phase 1 alone when there are no extra phases', () => {
    const d: Diagram = { courtType: 'half', elements: [marker('a')] }
    expect(diagramPhases(d)).toEqual([{ courtType: 'half', elements: [marker('a')] }])
  })

  it('flattens later phases into standalone diagrams on the same court', () => {
    const d: Diagram = { courtType: 'full', elements: [marker('a')], phases: [[marker('b')], []] }
    const phases = diagramPhases(d)
    expect(phases).toHaveLength(3)
    expect(phases.map((p) => p.courtType)).toEqual(['full', 'full', 'full'])
    expect(phases[1].elements[0].id).toBe('b')
    expect(phases[2].elements).toEqual([])
  })
})
