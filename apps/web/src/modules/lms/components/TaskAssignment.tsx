import { FileText } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'
import type { LinkedTask, TaskLink } from '@/modules/tasks/types'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { DropdownMenuItem } from '@/ui/dropdown-menu'
import { assignmentTargetsOptions, useAssignmentOf } from '../assignment/queries'
import { useAssignmentDetails } from '../assignment/target'

/** The platform assignment a to-do is (imported as one, or the to-do of an imported assessment). */
function useTaskAssignment(task: LinkedTask) {
  return useAssignmentOf(task.program_id, { taskId: task.id, assessmentId: task.assessment_id })
}

/**
 * A to-do's way to its assignment's details (M09 §7.3, contributed to `tasks.links`): a labelled
 * pill that is always there, not an icon that shows on hover. A finished to-do keeps it, for
 * the feedback.
 */
function AssignmentButton({ task, as, className, onOpen }: ComponentProps<TaskLink['Button']>) {
  const { open } = useAssignmentDetails()
  const assignment = useTaskAssignment(task)
  if (!assignment) return null
  const show = (event: React.MouseEvent) => {
    event.stopPropagation()
    onOpen?.()
    open(assignment.courseId, assignment.assignmentId)
  }
  if (as === 'button') {
    return (
      <Button type="button" variant="outline" className={className} onClick={show}>
        <FileText aria-hidden />
        {m.lms_assignment_view()}
      </Button>
    )
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      className={cn('shrink-0 rounded-full font-normal text-foreground', className)}
      onClick={show}
    >
      <FileText aria-hidden className="text-muted-foreground" />
      {m.lms_assignment_details()}
    </Button>
  )
}

function AssignmentMenuItem({ task }: { task: LinkedTask }) {
  const { open } = useAssignmentDetails()
  const assignment = useTaskAssignment(task)
  if (!assignment) return null
  return (
    <DropdownMenuItem onClick={() => open(assignment.courseId, assignment.assignmentId)}>
      <FileText aria-hidden />
      {m.lms_assignment_details()}
    </DropdownMenuItem>
  )
}

export const taskAssignmentLink: TaskLink = {
  id: 'lms.assignment',
  Button: AssignmentButton,
  MenuItem: AssignmentMenuItem,
  query: ({ programId }) => assignmentTargetsOptions(programId),
}
