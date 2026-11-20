import { lmsFeedbackListOptions } from '@semestra/api-client/react-query'

/**
 * The teacher's feedback kept for a course's imported assessments (M09 §4.4): read from
 * Semestra, so the gradebook knows at once which rows have some, also while the platform cannot
 * be reached.
 */
export const feedbackListOptions = (courseId: string) =>
  lmsFeedbackListOptions({ path: { course_id: courseId } })
