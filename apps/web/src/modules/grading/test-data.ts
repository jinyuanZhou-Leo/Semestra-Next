import type {
  Assessment,
  AssessmentCategory,
  CategorySummary,
  Gradebook,
  GradebookSummary,
} from '@semestra/api-client'

/** Fixtures for the grading tests. */

const stamp = '2026-01-01T00:00:00Z'

export function summary(overrides: Partial<GradebookSummary> = {}): GradebookSummary {
  return {
    status: 'in_progress',
    weight_total: 100,
    weight_gap: 0,
    weights_ok: true,
    graded_count: 1,
    remaining_count: 1,
    graded_weight: 40,
    remaining_weight: 60,
    locked_contribution: 32,
    current_percentage: 80,
    current_points: 3.7,
    current_letter: 'A-',
    final_percentage: null,
    final_points: null,
    final_letter: null,
    final_source: null,
    overridden: false,
    forecast_percentage: null,
    forecast_points: null,
    forecast_letter: null,
    predictions: {},
    missing_history_category_ids: [],
    target_points: 4,
    target_percentage: 85,
    required_average: 88.33,
    reachable: true,
    categories: [],
    ...overrides,
  }
}

export function category(
  overrides: Partial<AssessmentCategory> & { id: string },
): AssessmentCategory {
  return {
    course_id: 'c1',
    key: 'exam',
    name: 'Exam',
    color: 'amber',
    position: 0,
    archived: false,
    ...overrides,
  }
}

export function assessment(overrides: Partial<Assessment> & { id: string }): Assessment {
  return {
    course_id: 'c1',
    category_id: null,
    title: overrides.id,
    due_at: null,
    due_has_time: false,
    due_date: null,
    due_time: null,
    weight: 20,
    score_percentage: null,
    points_earned: null,
    points_possible: null,
    dropped: false,
    note: null,
    source_kind: null,
    source_ref: null,
    position: 0,
    status: 'pending',
    created_at: stamp,
    updated_at: stamp,
    ...overrides,
  }
}

/** The engine's per-category figures for these assessments (dropped ones do not count). */
export function categoryFigures(assessments: readonly Assessment[]): CategorySummary[] {
  const groups = new Map<string | null, Assessment[]>()
  for (const a of assessments) {
    if (!a.dropped) groups.set(a.category_id, [...(groups.get(a.category_id) ?? []), a])
  }
  return [...groups].map(([id, items]) => {
    const graded = items.filter((a) => a.score_percentage !== null)
    const gradedWeight = graded.reduce((sum, a) => sum + a.weight, 0)
    const points = graded.reduce((sum, a) => sum + a.weight * (a.score_percentage ?? 0), 0)
    return {
      category_id: id,
      weight: items.reduce((sum, a) => sum + a.weight, 0),
      graded_weight: gradedWeight,
      average: gradedWeight === 0 ? null : points / gradedWeight,
      contribution: points / 100,
    }
  })
}

/** A gradebook; its summary's category figures follow its assessments unless given. */
export function gradebook(overrides: Partial<Gradebook> = {}): Gradebook {
  const book = baseGradebook(overrides)
  if (book.summary.categories.length > 0) return book
  return { ...book, summary: { ...book.summary, categories: categoryFigures(book.assessments) } }
}

function baseGradebook(overrides: Partial<Gradebook>): Gradebook {
  return {
    course_id: 'c1',
    program_id: 'p1',
    scale: { max_points: 4, hide_gpa: false, round_before_lookup: true },
    result: {
      course_id: 'c1',
      basis: 'percentage',
      manual_percentage: null,
      final_override_percentage: null,
      pass_fail_result: null,
      target_points: null,
      forecast_model: 'auto',
      gradebook_enabled: true,
      updated_at: stamp,
    },
    categories: [category({ id: 'k1' })],
    assessments: [
      assessment({
        id: 'a1',
        title: 'Quiz 1',
        weight: 40,
        score_percentage: 80,
        status: 'graded',
        position: 0,
      }),
      assessment({ id: 'a2', title: 'Final exam', weight: 60, position: 1, category_id: 'k1' }),
    ],
    summary: summary(),
    ...overrides,
  }
}
