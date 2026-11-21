import type { Assessment } from '@semestra/api-client'
import { FileText, MessageSquareText } from 'lucide-react'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { useAssignmentTarget } from '../assignment/queries'
import { useAssignmentDetails } from '../assignment/target'

/**
 * The gradebook's assignment column (M03 §5.1, contributed by M09): on every assessment that is
 * an assignment of the platform, a button that opens the assignment's details (M09 §7.3). Where
 * the teacher left comments or a rubric assessment, it is the feedback button instead, in the
 * accent color, and opens the details on the submission and feedback.
 */
export function AssessmentAssignmentCell({
  assessment,
  programId,
}: {
  assessment: Assessment
  programId: string
}) {
  const { open } = useAssignmentDetails()
  const target = useAssignmentTarget(programId, { assessmentId: assessment.id })
  if (!target) return null
  const feedback = target.feedback
  const tip = feedback ? m.lms_feedback_open() : m.lms_assignment_view()
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className={feedback ? 'text-primary' : 'text-muted-foreground'}
            aria-label={`${tip}: ${assessment.title}`}
            onClick={() =>
              open(target.course_id, target.assignment_id, feedback ? 'feedback' : 'details')
            }
          />
        }
      >
        {feedback ? <MessageSquareText aria-hidden /> : <FileText aria-hidden />}
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}
