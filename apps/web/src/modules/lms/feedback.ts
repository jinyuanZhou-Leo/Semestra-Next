import { lmsFeedbackListOptions } from '@semestra/api-client/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { coursePath } from '@/modules/academics/paths'

/**
 * The teacher's feedback kept for a course's imported assessments (M09 §4.3): read from
 * Semestra, so the gradebook shows it at once and while the platform cannot be reached.
 */
export const feedbackListOptions = (courseId: string) =>
  lmsFeedbackListOptions({ path: { course_id: courseId } })

/** The gradebook with an assessment's feedback open (`?feedback=<assessment id>`). */
export function feedbackPath(programId: string, courseId: string, assessmentId: string) {
  return `${coursePath(programId, courseId, 'grades')}?feedback=${encodeURIComponent(assessmentId)}`
}

/**
 * Which assessment's feedback the gradebook has open, kept in its URL so a link (the sync
 * panel's recent updates) opens it. Opening and closing replace the entry: the dialog is not a
 * step of its own in the history.
 */
export function useFeedbackParam() {
  const search = useSearch({ strict: false }) as Record<string, unknown>
  const navigate = useNavigate()
  const go = (id: string | null) =>
    void navigate({
      to: '.',
      search: (prev: Record<string, string | undefined>) => {
        const next = { ...prev }
        if (id) next.feedback = id
        else delete next.feedback
        // The route reads it back as text (`pageSearch`).
        return next as Record<string, string>
      },
      replace: true,
    })
  const value = search.feedback
  return {
    assessmentId: typeof value === 'string' && value ? value : null,
    show: (id: string) => go(id),
    close: () => go(null),
  }
}
