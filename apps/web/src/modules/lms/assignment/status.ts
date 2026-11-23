import type { AssignmentOut } from '@semestra/api-client'
import { formatDaysUntil } from '@/lib/format'
import { m } from '@/paraglide/messages'

/**
 * Where the user is with an assignment, as the server works it out (`rules.assignment_state`, M09):
 * the details, the to-do's card and the Canvas tab's badges and filters only show it.
 */
export type AssignmentState = NonNullable<AssignmentOut['state']>

/**
 * What the platform marks an assignment with beside its state, as the server gives it (M09 3b
 * marks, `rules.marks`): shown as they come, never worked out from the platform's flags here.
 */
export type Mark = NonNullable<AssignmentOut['marks']>[number]

export const MARK_LABELS: Record<Mark, () => string> = {
  missing: m.lms_assignment_missing,
  late: m.lms_assignment_late,
}

/** Whether the due date still matters, as the server works it out (M09 table 3d). */
export type DueState = AssignmentOut['due_state']

/** The due hint table 3d gives a due state: "Due in 3 days", "Past due", "Overdue"; none for `none`. */
export function dueHint(
  dueState: DueState,
  dueAt: string | null | undefined,
  now: number,
): string | null {
  if (dueState === 'upcoming' && dueAt) {
    return m.lms_assignment_due_in({ when: formatDaysUntil(new Date(dueAt), now) })
  }
  if (dueState === 'past') return m.lms_assignment_past_due()
  if (dueState === 'overdue') return m.lms_assignment_overdue()
  return null
}

export const STATE_LABELS: Record<AssignmentState, () => string> = {
  graded: m.lms_assignment_graded,
  excused: m.lms_assignment_excused,
  submitted: m.lms_assignment_submitted,
  missing: m.lms_assignment_missing,
  unsubmitted: m.lms_assignment_unsubmitted,
  offline: m.lms_assignment_offline,
}

/** The platform's ways to hand in (`submission_types`), as a student reads them. */
const SUBMISSION_TYPES: Record<string, () => string> = {
  online_upload: m.lms_submit_upload,
  online_text_entry: m.lms_submit_text,
  online_url: m.lms_submit_url,
  online_quiz: m.lms_submit_quiz,
  media_recording: m.lms_submit_media,
  student_annotation: m.lms_submit_annotation,
  discussion_topic: m.lms_submit_discussion,
  external_tool: m.lms_submit_external,
  on_paper: m.lms_submit_paper,
  none: m.lms_submit_none,
}

export const submissionTypeLabel = (type: string) => SUBMISSION_TYPES[type]?.() ?? type

/** "2 hours", "3 days": how late a submission was. */
export function latenessLabel(seconds: number): string {
  const hours = Math.max(1, Math.round(seconds / 3600))
  return hours < 48
    ? m.lms_assignment_late_hours({ count: hours })
    : m.lms_assignment_late_days({ count: Math.round(hours / 24) })
}
