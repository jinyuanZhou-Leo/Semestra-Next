import type { Assessment, AssignmentOut, LmsAssignmentListResponse } from '@semestra/api-client'
import { lmsAssignmentListOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { MessageSquareText } from 'lucide-react'
import { useEffect } from 'react'
import { preload, preloadable } from '@/app/extensions'
import { useDialogTarget } from '@/lib/dialog-target'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'

const FeedbackDialog = preloadable(() => import('./FeedbackDialog'))

/** The platform assignment each assessment follows, by assessment id. */
const byAssessment = (list: LmsAssignmentListResponse): ReadonlyMap<string, AssignmentOut> =>
  new Map(
    list.items.flatMap((a) =>
      a.imported_as?.kind === 'assessment' ? [[a.imported_as.id, a] as const] : [],
    ),
  )

/** The platform has a grade for the user's submission, so its feedback is worth opening. */
function graded(a: AssignmentOut): boolean {
  const s = a.submission
  return Boolean(s && (s.state === 'graded' || s.graded_at || s.score != null))
}

/**
 * The gradebook's feedback column (M03 §5.1, contributed by M09): on an assessment that follows a
 * graded LMS assignment, a button that opens the teacher's comments and the rubric.
 */
export function AssessmentFeedbackCell({ assessment }: { assessment: Assessment }) {
  const dialog = useDialogTarget<AssignmentOut>()
  const assignment = useQuery({
    ...lmsAssignmentListOptions({ path: { course_id: assessment.course_id } }),
    select: byAssessment,
  }).data?.get(assessment.id)
  const offered = Boolean(assignment && graded(assignment))
  // The dialog's code loads once a row offers it, not with the app.
  useEffect(() => {
    if (offered) void preload(FeedbackDialog)
  }, [offered])
  if (!assignment || !offered) return null
  // Shown once its code is here, so opening never suspends the gradebook row.
  const open = () => void preload(FeedbackDialog).then(() => dialog.show(assignment))
  const label = `${m.lms_feedback_open()}: ${assessment.title}`
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label={label} onClick={open} />}
        >
          <MessageSquareText aria-hidden />
        </TooltipTrigger>
        <TooltipContent>{m.lms_feedback_open()}</TooltipContent>
      </Tooltip>
      {dialog.target ? (
        <FeedbackDialog {...dialog.props} assessment={assessment} assignment={dialog.target} />
      ) : null}
    </>
  )
}
