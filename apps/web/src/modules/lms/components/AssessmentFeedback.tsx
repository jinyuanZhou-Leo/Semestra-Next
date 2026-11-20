import type { Assessment } from '@semestra/api-client'
import { useQuery } from '@tanstack/react-query'
import { MessageSquareText } from 'lucide-react'
import type { AssessmentAction, AssessmentActionItemProps } from '@/modules/grading/types'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { DropdownMenuItem } from '@/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { assignmentTargetsOptions, useAssignmentOf } from '../assignment/queries'
import { useAssignmentDetails } from '../assignment/target'
import { feedbackListOptions } from '../feedback'

/**
 * The gradebook's feedback column (M03 §5.1, contributed by M09): on an assessment whose teacher
 * left comments or a rubric assessment on the platform, a button that opens the assignment's
 * details on its submission and feedback (M09 §7.3).
 */
export function AssessmentFeedbackCell({ assessment }: { assessment: Assessment }) {
  const { open } = useAssignmentDetails()
  const feedback = useQuery({
    ...feedbackListOptions(assessment.course_id),
    select: (list) => list.items.find((f) => f.assessment_id === assessment.id),
  }).data
  if (!feedback) return null
  const label = `${m.lms_feedback_open()}: ${assessment.title}`
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            onClick={() => open(assessment.course_id, feedback.assignment_id, 'feedback')}
          />
        }
      >
        <MessageSquareText aria-hidden />
      </TooltipTrigger>
      <TooltipContent>{m.lms_feedback_open()}</TooltipContent>
    </Tooltip>
  )
}

/** "View assignment" in the row menu of an assessment that is an assignment of the platform. */
function ViewItem({ assessment, programId }: AssessmentActionItemProps) {
  const { open } = useAssignmentDetails()
  const assignment = useAssignmentOf(programId, { assessmentId: assessment.id })
  if (!assignment) return null
  return (
    <DropdownMenuItem onClick={() => open(assignment.courseId, assignment.assignmentId)}>
      {m.lms_assignment_view()}
    </DropdownMenuItem>
  )
}

export const viewAction: AssessmentAction = {
  id: 'lms.view',
  query: ({ programId }) => assignmentTargetsOptions(programId),
  Item: ViewItem,
}
