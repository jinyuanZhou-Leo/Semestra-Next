import type { AssignmentTargets } from '@semestra/api-client'
import { FileText } from 'lucide-react'
import type { TaskLink } from '@/modules/tasks/types'
import { m } from '@/paraglide/messages'
import { assignmentOf, assignmentTargetsOptions } from '../assignment/queries'
import { openAssignmentDetails } from '../assignment/target'

/**
 * A to-do's way to its assignment's details (M09 §7.3, contributed to `tasks.links`): for a
 * to-do imported as one, or the to-do of an imported assessment. A finished to-do keeps it, for
 * the feedback.
 */
export const taskAssignmentLink: TaskLink = {
  id: 'lms.assignment',
  icon: FileText,
  label: () => m.lms_assignment_details(),
  action: () => m.lms_assignment_view(),
  query: ({ programId }) => assignmentTargetsOptions(programId),
  open: (task, data, router) => {
    const found = assignmentOf(data as AssignmentTargets, {
      taskId: task.id,
      assessmentId: task.assessment_id,
    })
    return found
      ? () =>
          openAssignmentDetails(router, found.courseId, found.assignmentId, 'details', found.held)
      : null
  },
}
