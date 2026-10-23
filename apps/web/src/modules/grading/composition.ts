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
  /** Weight without a real score that plan mode assumed a score for. */
  assumed: number
  /** Weighted average of the real scores; null with nothing graded. */
  average: number | null
  /** Weighted average of real and assumed scores; null when neither exists. */
  plannedAverage: number | null
  /** Percentage points the real scores add to the course grade. */
  contribution: number
}

const byId = (rows: readonly CategorySummary[] | undefined) =>
  new Map((rows ?? []).map((row) => [row.category_id, row]))

/**
 * How the course grade is made up, per category in the categories' order (loose assessments
 * last). The figures come from the engine (`summary.categories`); `planned` is the simulated
 * summary, whose graded weight includes the assumed scores.
 */
export function composition(
  summary: GradebookSummary,
  planned: GradebookSummary | null,
  categories: readonly AssessmentCategory[],
): CompositionSlice[] {
  const real = byId(summary.categories)
  const plan = planned ? byId(planned.categories) : null
  const known = new Set(categories.map((c) => c.id))
  const order: (AssessmentCategory | null)[] = [
    ...categories.toSorted((a, b) => a.position - b.position),
    null,
  ]
  return order.flatMap((category) => {
    const id = category?.id ?? null
    const row = real.get(id)
    if (!row || row.weight <= 0 || (id !== null && !known.has(id))) return []
    const simulated = plan?.get(id)
    return [
      {
        id,
        category,
        weight: row.weight,
        graded: row.graded_weight,
        assumed: simulated ? Math.max(0, simulated.graded_weight - row.graded_weight) : 0,
        average: row.average,
        plannedAverage: simulated ? simulated.average : row.average,
        contribution: row.contribution,
      },
    ]
  })
}
