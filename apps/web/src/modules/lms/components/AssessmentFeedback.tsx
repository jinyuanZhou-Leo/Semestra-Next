import type { Assessment } from '@semestra/api-client'
import { useQuery } from '@tanstack/react-query'
import { MessageSquareText } from 'lucide-react'
import { Suspense } from 'react'
import { preloadable } from '@/app/extensions'
import type { AssessmentColumnDialogProps } from '@/modules/grading/types'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { feedbackListOptions, useFeedbackParam } from '../feedback'

// Loads with the column (the gradebook mounts it once the course has feedback), not the app.
const FeedbackDialog = preloadable<AssessmentColumnDialogProps>(() => import('./FeedbackDialog'))

/**
 * The gradebook's feedback column (M03 §5.1, contributed by M09): on an assessment whose teacher
 * left comments or a rubric assessment on the platform, a button that opens them.
 */
export function AssessmentFeedbackCell({ assessment }: { assessment: Assessment }) {
  const { show } = useFeedbackParam()
  const has = useQuery({
    ...feedbackListOptions(assessment.course_id),
    select: (list) => list.items.some((f) => f.assessment_id === assessment.id),
  }).data
  if (!has) return null
  const label = `${m.lms_feedback_open()}: ${assessment.title}`
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            onClick={() => show(assessment.id)}
          />
        }
      >
        <MessageSquareText aria-hidden />
      </TooltipTrigger>
      <TooltipContent>{m.lms_feedback_open()}</TooltipContent>
    </Tooltip>
  )
}

/** The column's one dialog. */
export function AssessmentFeedbackDialog(props: AssessmentColumnDialogProps) {
  return (
    <Suspense fallback={null}>
      <FeedbackDialog {...props} />
    </Suspense>
  )
}
