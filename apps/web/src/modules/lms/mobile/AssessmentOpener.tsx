import type { Assessment } from '@semestra/api-client'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { assignmentTargetsOptions, heldFor } from '../assignment/queries'
import { useAssignmentDetails } from '../assignment/target'

/**
 * On the phone's grades list (M17 §4.1), an assessment that is a platform assignment opens its
 * details, on the feedback when the teacher left some, as the gradebook's button does.
 */
export default function AssessmentOpener({
  assessment,
  programId,
  children,
}: {
  assessment: Assessment
  programId: string
  children: (open: (() => void) | null) => ReactNode
}) {
  const target = useQuery(assignmentTargetsOptions(programId)).data?.items.find(
    (t) => t.assessment_id === assessment.id,
  )
  const { open } = useAssignmentDetails()
  return children(
    target
      ? () =>
          open(
            target.course_id,
            target.assignment_id,
            target.feedback ? 'feedback' : 'details',
            heldFor(target),
          )
      : null,
  )
}
