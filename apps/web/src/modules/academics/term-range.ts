import type { Term } from '@semestra/api-client'

/** The end of a range whose next term has not been added yet (`planned_terms` 2, one term). */
export const NEXT_TERM = '__next__'

/**
 * A course's terms as the run they always are (M02 §3): a start, an end, and whether it spans more
 * than one term. A year-long course whose second term is not there yet ends at `NEXT_TERM`.
 */
export type TermRange = { start: string; end: string }

export function rangeOf(terms: readonly Term[], termIds: readonly string[], planned: number) {
  const linked = terms.filter((t) => termIds.includes(t.id))
  const start = linked[0]?.id ?? terms[0]?.id ?? ''
  const last = linked.at(-1)?.id ?? start
  const spanning = planned > 1 || linked.length > 1
  return { start, end: spanning && last === start ? NEXT_TERM : last, spanning }
}

/** The terms after `start` a range may end at; `NEXT_TERM` when there are none yet. */
export function endChoices(terms: readonly Term[], start: string): string[] {
  const after = terms.slice(terms.findIndex((t) => t.id === start) + 1).map((t) => t.id)
  return after.length > 0 ? after : [NEXT_TERM]
}

/** A range that spans: the same end if it still comes after `start`, else the first one that does. */
export function spanFrom(terms: readonly Term[], start: string, end: string): TermRange {
  const choices = endChoices(terms, start)
  return { start, end: choices.includes(end) ? end : (choices[0] ?? NEXT_TERM) }
}

/** What to save for a range: the linked terms and `planned_terms`. */
export function rangeTerms(
  terms: readonly Term[],
  range: TermRange | { start: string; end: null },
) {
  const ids = terms.map((t) => t.id)
  const from = ids.indexOf(range.start)
  if (range.end === null) return { term_ids: [range.start], planned_terms: 1 }
  if (range.end === NEXT_TERM) return { term_ids: [range.start], planned_terms: 2 }
  const term_ids = ids.slice(from, ids.indexOf(range.end) + 1)
  return { term_ids, planned_terms: term_ids.length }
}
