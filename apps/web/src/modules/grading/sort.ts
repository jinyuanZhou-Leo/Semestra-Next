import type { AssessmentCategory } from '@semestra/api-client'

/** `manual` keeps the order the user gave the items (their `position`). */
export type SortKey = 'manual' | 'due' | 'category' | 'weight' | 'title'
export type SortPref = { key: SortKey; dir: 'asc' | 'desc' }
export const DEFAULT_SORT: SortPref = { key: 'manual', dir: 'asc' }

export type SortValue = string | number | null

/** Ascending order; items without a value come last. */
export function compareValues(a: SortValue, b: SortValue): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

export type AssessmentGroup<T> = { category: AssessmentCategory | null; items: T[] }

/** Items grouped by category in the categories' order, keeping their order; loose ones last. */
export function groupByCategory<T>(
  items: readonly T[],
  categories: readonly AssessmentCategory[],
  categoryOf: (item: T) => string | null,
): AssessmentGroup<T>[] {
  const known = new Set(categories.map((c) => c.id))
  const groups: AssessmentGroup<T>[] = categories
    .toSorted((a, b) => a.position - b.position)
    .map((category) => ({
      category,
      items: items.filter((item) => categoryOf(item) === category.id),
    }))
  groups.push({
    category: null,
    items: items.filter((item) => {
      const id = categoryOf(item)
      return id === null || !known.has(id)
    }),
  })
  return groups.filter((g) => g.items.length > 0)
}
