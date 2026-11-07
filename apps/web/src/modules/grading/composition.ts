import type { AssessmentCategory, CategorySummary, GradebookSummary } from '@semestra/api-client'

/** One category's share of the course grade, from the server's per-category figures. */
export type CompositionSlice = {
  /** The category id; null holds the assessments without one. */
  id: string | null
  category: AssessmentCategory | null
  /** Weight of the category's assessments (percentage points of the course). */
  weight: number
  /** Weight that has a real score. */
  graded: number
  /** Weighted average of the real scores; null with nothing graded. */
  average: number | null
  /** Percentage points the real scores add to the course grade. */
  contribution: number
}

const byId = (rows: readonly CategorySummary[] | undefined) =>
  new Map((rows ?? []).map((row) => [row.category_id, row]))

/**
 * How the course grade is made up, per category in the categories' order (loose assessments
 * last). The figures come from the engine (`summary.categories`).
 */
export function composition(
  summary: GradebookSummary,
  categories: readonly AssessmentCategory[],
): CompositionSlice[] {
  const real = byId(summary.categories)
  const known = new Set(categories.map((c) => c.id))
  const order: (AssessmentCategory | null)[] = [
    ...categories.toSorted((a, b) => a.position - b.position),
    null,
  ]
  return order.flatMap((category) => {
    const id = category?.id ?? null
    const row = real.get(id)
    if (!row || row.weight <= 0 || (id !== null && !known.has(id))) return []
    return [
      {
        id,
        category,
        weight: row.weight,
        graded: row.graded_weight,
        average: row.average,
        contribution: row.contribution,
      },
    ]
  })
}
