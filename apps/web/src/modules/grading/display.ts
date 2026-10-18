import type { AssessmentCategory } from '@semestra/api-client'
import { formatPercent } from '@/lib/format'
import { subjectColor } from '@/lib/subject-color'
import { m } from '@/paraglide/messages'

/** The built-in category colors are names; they map to the theme's subject palette. */
const NAMED_COLORS: Record<string, string> = {
  blue: 'subject-8',
  amber: 'subject-3',
  emerald: 'subject-5',
  violet: 'subject-9',
  cyan: 'subject-7',
  rose: 'subject-11',
  slate: 'subject-12',
}

export function categoryColor(color: string): string {
  return subjectColor(NAMED_COLORS[color] ?? color)
}

const BUILT_IN_NAMES: Record<string, { en: string; label: () => string }> = {
  quiz: { en: 'Quiz', label: () => m.grading_category_quiz() },
  exam: { en: 'Exam', label: () => m.grading_category_exam() },
  assignment: { en: 'Assignment', label: () => m.grading_category_assignment() },
  project: { en: 'Project', label: () => m.grading_category_project() },
  lab: { en: 'Lab', label: () => m.grading_category_lab() },
  presentation: { en: 'Presentation', label: () => m.grading_category_presentation() },
  participation: { en: 'Participation', label: () => m.grading_category_participation() },
}

/** A built-in category the user has not renamed is shown in the interface language. */
export function categoryName(category: Pick<AssessmentCategory, 'key' | 'name'>): string {
  const builtIn = BUILT_IN_NAMES[category.key]
  return builtIn && builtIn.en === category.name ? builtIn.label() : category.name
}

/** A percentage from the API (0–100) as text, "—" when there is none. */
export function percentText(value: number | null | undefined): string {
  return value == null ? '—' : formatPercent(value / 100)
}

/** The mask shown in place of a GPA while `hide_gpa` is on (M03 §5.3). */
export const GPA_MASK = '•••'
