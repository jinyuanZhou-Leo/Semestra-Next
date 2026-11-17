import type { Assessment, AssignmentOut, LmsAssignmentListResponse } from '@semestra/api-client'
import { lmsAssignmentListOptions, lmsSubmissionGetOptions } from '@semestra/api-client/react-query'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquareText } from 'lucide-react'
import { useEffect, useState } from 'react'
import { preload, preloadable } from '@/app/extensions'
import { useDialogTarget } from '@/lib/dialog-target'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Spinner } from '@/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'

const FeedbackDialog = preloadable(() => import('./FeedbackDialog'))

/** The platform assignment each assessment follows, by assessment id. */
const byAssessment = (list: LmsAssignmentListResponse): ReadonlyMap<string, AssignmentOut> =>
  new Map(
    list.items.flatMap((a) =>
      a.imported_as?.kind === 'assessment' ? [[a.imported_as.id, a] as const] : [],
    ),
  )

/**
 * The user handed it in or the platform graded it, so the teacher may have left feedback. The
 * assignment list does not say whether there are comments; one on work never handed in or graded
 * is still read in the platform (or the course's LMS tab).
 */
function reviewable(a: AssignmentOut): boolean {
  const s = a.submission
  return Boolean(
    s &&
    ((s.state && s.state !== 'unsubmitted') || s.submitted_at || s.graded_at || s.score != null),
  )
}

/**
 * The gradebook's feedback column (M03 §5.1, contributed by M09): on an assessment that follows a
 * handed-in or graded LMS assignment, a button that opens the teacher's comments and the rubric.
 */
export function AssessmentFeedbackCell({ assessment }: { assessment: Assessment }) {
  const queryClient = useQueryClient()
  const dialog = useDialogTarget<AssignmentOut>()
  const [opening, setOpening] = useState(false)
  const assignment = useQuery({
    ...lmsAssignmentListOptions({ path: { course_id: assessment.course_id } }),
    select: byAssessment,
  }).data?.get(assessment.id)
  const offered = Boolean(assignment && reviewable(assignment))
  // The dialog's code loads once a row offers it, not with the app.
  useEffect(() => {
    if (offered) void preload(FeedbackDialog)
  }, [offered])
  if (!assignment || !offered) return null
  // Shown once its code and the submission are here, so opening never suspends the gradebook
  // row and the dialog opens at its full size. A failed read opens it too, showing the error.
  const open = () => {
    setOpening(true)
    const submission = lmsSubmissionGetOptions({
      path: { course_id: assessment.course_id, assignment_id: assignment.external_id },
    })
    void Promise.allSettled([preload(FeedbackDialog), queryClient.ensureQueryData(submission)])
      .then(() => dialog.show(assignment))
      .then(() => setOpening(false))
  }
  const label = `${m.lms_feedback_open()}: ${assessment.title}`
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={label}
              aria-busy={opening}
              disabled={opening}
              onClick={open}
            />
          }
        >
          {opening ? <Spinner /> : <MessageSquareText aria-hidden />}
        </TooltipTrigger>
        <TooltipContent>{m.lms_feedback_open()}</TooltipContent>
      </Tooltip>
      {dialog.target ? (
        <FeedbackDialog {...dialog.props} assessment={assessment} assignment={dialog.target} />
      ) : null}
    </>
  )
}
