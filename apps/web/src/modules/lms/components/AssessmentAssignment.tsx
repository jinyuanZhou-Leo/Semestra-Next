import type { Assessment } from '@semestra/api-client'
import { MessageSquareText } from 'lucide-react'
import { useState } from 'react'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { heldFor, useAssignmentTarget } from '../assignment/queries'
import { useAssignmentDetails } from '../assignment/target'
import { LockMark, SubmissionStatus, assignmentKind } from './AssignmentStatus'

/**
 * The gradebook's submission column (M03 §5.1, contributed by M09): on every assessment that is
 * an assignment of the platform, where the user's submission stands, as the Canvas tab shows it
 * (state, marks, due hint, lock), after the button that opens the assignment's details (M09
 * §7.3) with its kind's icon. Where the teacher left comments or a rubric assessment, the button
 * is the feedback one instead, in the accent color, and opens the details on the feedback.
 */
export function AssessmentAssignmentCell({
  assessment,
  programId,
}: {
  assessment: Assessment
  programId: string
}) {
  const { open } = useAssignmentDetails()
  // Read once, so "due in 3 days" doesn't change between renders.
  const [now] = useState(Date.now)
  const target = useAssignmentTarget(programId, { assessmentId: assessment.id })
  if (!target) return null
  const feedback = target.feedback
  const tip = feedback ? m.lms_feedback_open() : m.lms_assignment_view()
  const { Icon } = assignmentKind(target.submission_types ?? [], target.is_quiz ?? false)
  return (
    <span className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className={feedback ? 'text-primary' : 'text-muted-foreground'}
              aria-label={`${tip}: ${assessment.title}`}
              onClick={() =>
                open(
                  target.course_id,
                  target.assignment_id,
                  feedback ? 'feedback' : 'details',
                  heldFor(target),
                )
              }
            />
          }
        >
          {feedback ? <MessageSquareText aria-hidden /> : <Icon aria-hidden />}
        </TooltipTrigger>
        <TooltipContent>{tip}</TooltipContent>
      </Tooltip>
      <SubmissionStatus
        state={target.state}
        marks={target.marks}
        dueState={target.due_state ?? 'none'}
        dueAt={assessment.due_at}
        now={now}
      />
      {target.locked ? <LockMark explanation={target.lock_explanation} /> : null}
    </span>
  )
}
