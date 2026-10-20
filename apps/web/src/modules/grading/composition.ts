import type { Assessment, AssessmentCategory } from '@semestra/api-client'
import { groupByCategory } from './sort'

/** One category's share of the course grade, from the assessments that count (not dropped). */
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

const weightedAverage = (pairs: readonly (readonly [number, number])[]): number | null => {
  const weight = pairs.reduce((sum, [w]) => sum + w, 0)
  if (weight === 0) return null
  return pairs.reduce((sum, [w, score]) => sum + w * score, 0) / weight
}

/**
 * How the course grade is made up, per category in the categories' order (loose assessments
 * last). Display only: the grade itself always comes from the server's engine.
 */
export function composition(
  assessments: readonly Assessment[],
  categories: readonly AssessmentCategory[],
  assumed: Readonly<Record<string, number>>,
): CompositionSlice[] {
  const counted = assessments.filter((a) => !a.dropped && a.weight > 0)
  return groupByCategory(counted, categories, (a) => a.category_id).map(({ category, items }) => {
    const real = items.flatMap((a) =>
      a.score_percentage === null ? [] : [[a.weight, a.score_percentage] as const],
    )
    const guessed = items.flatMap((a) => {
      const value = a.score_percentage === null ? assumed[a.id] : undefined
      return value === undefined ? [] : [[a.weight, value] as const]
    })
    return {
      id: category?.id ?? null,
      category,
      weight: items.reduce((sum, a) => sum + a.weight, 0),
      graded: real.reduce((sum, [w]) => sum + w, 0),
      assumed: guessed.reduce((sum, [w]) => sum + w, 0),
      average: weightedAverage(real),
      plannedAverage: weightedAverage([...real, ...guessed]),
      contribution: real.reduce((sum, [w, score]) => sum + (w * score) / 100, 0),
    }
  })
}
