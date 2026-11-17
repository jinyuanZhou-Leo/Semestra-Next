import type { AssignmentOut, Quiz } from '@semestra/api-client'
import { lmsSubmissionGetOptions } from '@semestra/api-client/react-query'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { SubmissionFeedback } from '@/modules/lms/components/SubmissionFeedback'
import { CanvasBoundary, ListSkeleton } from '../CanvasBoundary'
import { useCanvasPage } from '../context'
import { CanvasHtml, DisplayMenu, LockNote, OpenInCanvasIcon, attemptsLabel } from './common'

/** Canvas `submission_types`, as a student reads them. */
const SUBMISSION_TYPES: Record<string, () => string> = {
  online_upload: m.canvas_tab_submit_upload,
  online_text_entry: m.canvas_tab_submit_text,
  online_url: m.canvas_tab_submit_url,
  online_quiz: m.canvas_tab_submit_quiz,
  media_recording: m.canvas_tab_submit_media,
  student_annotation: m.canvas_tab_submit_annotation,
  discussion_topic: m.canvas_tab_submit_discussion,
  external_tool: m.canvas_tab_submit_external,
  on_paper: m.canvas_tab_submit_paper,
  none: m.canvas_tab_submit_none,
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  )
}

/**
 * An assignment opened in the list: when it can be submitted and how, why it is locked, its
 * description, then the user's grade with the teacher's comments and rubric (M16 §4). A quiz adds
 * its questions and time limit; a practice quiz (no assignment, no grade) has no feedback.
 */
export function AssignmentDetail({
  assignment: a,
  quiz,
  practice = false,
}: {
  assignment: AssignmentOut
  quiz?: Quiz | null
  practice?: boolean
}) {
  const types = (a.submission_types ?? []).map((t) => SUBMISSION_TYPES[t]?.() ?? t)
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          {a.unlock_at ? (
            <Fact label={m.canvas_tab_available_from()} value={formatDateTime(a.unlock_at)} />
          ) : null}
          {a.lock_at ? (
            <Fact label={m.canvas_tab_available_until()} value={formatDateTime(a.lock_at)} />
          ) : null}
          {types.length > 0 ? (
            <Fact label={m.canvas_tab_submit_by()} value={types.join(', ')} />
          ) : null}
          <Fact
            label={m.canvas_tab_column_attempts()}
            value={attemptsLabel(quiz ? quiz.allowed_attempts : a.allowed_attempts)}
          />
          {quiz?.question_count != null ? (
            <Fact label={m.canvas_tab_column_questions()} value={String(quiz.question_count)} />
          ) : null}
          {quiz ? (
            <Fact
              label={m.canvas_tab_column_time_limit()}
              value={
                quiz.time_limit
                  ? m.canvas_tab_minutes({ count: quiz.time_limit })
                  : m.canvas_tab_no_time_limit()
              }
            />
          ) : null}
        </dl>
        <div className="flex shrink-0 items-center gap-1">
          {a.html ? <DisplayMenu /> : null}
          {a.web_url ? <OpenInCanvasIcon href={a.web_url} /> : null}
        </div>
      </div>
      {a.locked ? (
        <LockNote title={m.canvas_tab_assignment_locked()} explanation={a.lock_explanation} />
      ) : null}
      {a.html ? (
        <CanvasHtml html={a.html} />
      ) : (
        <p className="text-sm text-muted-foreground">{m.canvas_tab_no_description()}</p>
      )}
      {practice ? null : <Feedback assignment={a} />}
    </div>
  )
}

function Feedback({ assignment: a }: { assignment: AssignmentOut }) {
  const { courseId } = useCanvasPage()
  const submission = useQuery({
    ...lmsSubmissionGetOptions({ path: { course_id: courseId, assignment_id: a.external_id } }),
    placeholderData: keepPreviousData,
  })
  return (
    <section className="space-y-3" aria-label={m.lms_feedback()}>
      <h3 className="text-sm font-medium">{m.lms_feedback()}</h3>
      <CanvasBoundary query={submission} skeleton={<ListSkeleton rows={2} />}>
        {(s) => <SubmissionFeedback submission={s} assignment={a} />}
      </CanvasBoundary>
    </section>
  )
}
