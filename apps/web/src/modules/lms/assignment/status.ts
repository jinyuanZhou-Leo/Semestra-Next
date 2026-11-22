import type { SubmissionDetail } from '@semestra/api-client'
import { m } from '@/paraglide/messages'

/**
 * Where the user is with an assignment: the one rule every place that shows it follows (the
 * details, the to-do's card, the Canvas tab's badges and filters). The server says how the
 * submission stands (`status`); not handed in, it is missing when the platform says so, or
 * `offline` when nothing is handed in online (on paper, or not at all), so it is never "due".
 * A missing assignment the teacher graded (a zero under a late policy) is graded.
 */
export type AssignmentState =
  | 'graded'
  | 'excused'
  | 'submitted'
  | 'missing'
  | 'unsubmitted'
  | 'offline'

type Handed = Pick<SubmissionDetail, 'status' | 'missing'>

export function assignmentState(
  s: Handed | null | undefined,
  online: boolean | undefined = true,
): AssignmentState {
  if (s && s.status !== 'unsubmitted') return s.status
  if (s?.missing) return 'missing'
  return online === false ? 'offline' : 'unsubmitted'
}

/** Not yet handed in, and there is something to hand in: "Submit in …", due soon, "To do". */
export const isOpen = (state: AssignmentState) => state === 'unsubmitted' || state === 'missing'

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
