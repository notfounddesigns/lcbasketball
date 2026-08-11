import type { Diagram } from '@/types'

/**
 * A play's phases as standalone diagrams, in order.
 *
 * Phase 1 lives on `diagram.elements` and any later phases in `diagram.phases`,
 * but renderers only ever draw `elements` — so anything that shows a whole play
 * (print sheets, animation) needs each phase flattened into its own `Diagram`.
 */
export function diagramPhases(diagram: Diagram): Diagram[] {
  const base: Diagram = { courtType: diagram.courtType, elements: diagram.elements }
  const extras = (diagram.phases ?? []).map((elements) => ({ courtType: diagram.courtType, elements }))
  return [base, ...extras]
}
