import type { SubmissionDetail } from '@semestra/api-client'
import { m } from '@/paraglide/messages'

/** Where the user is with an assignment, as its details say it in large type. */
export type AssignmentState = 'graded' | 'excused' | 'submitted' | 'missing' | 'unsubmitted'

type Handed = Pick<SubmissionDetail, 'status' | 'missing'>

export function assignmentState(s: Handed | null | undefined): AssignmentState {
  if (s && s.status !== 'unsubmitted') return s.status
  return s?.missing ? 'missing' : 'unsubmitted'
}

export const STATE_LABELS: Record<AssignmentState, () => string> = {
  graded: m.lms_assignment_graded,
  excused: m.lms_assignment_excused,
  submitted: m.lms_assignment_submitted,
  missing: m.lms_assignment_missing,
  unsubmitted: m.lms_assignment_unsubmitted,
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

/** Nothing to hand in online: no "Submit in …" button, and no "not submitted yet". */
export function submitsOnline(types: readonly string[] | undefined): boolean {
  const offline = new Set(['on_paper', 'none', 'not_graded'])
  return !types?.length || types.some((t) => !offline.has(t))
}

/** "2 hours", "3 days": how late a submission was. */
export function latenessLabel(seconds: number): string {
  const hours = Math.max(1, Math.round(seconds / 3600))
  return hours < 48
    ? m.lms_assignment_late_hours({ count: hours })
    : m.lms_assignment_late_days({ count: Math.round(hours / 24) })
}
