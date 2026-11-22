import type { AssignmentTarget } from '@semestra/api-client'
import { lmsCourseLinkGetOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { School } from 'lucide-react'
import { formatDateTime } from '@/lib/format'
import type { TaskDetailSectionProps } from '@/modules/tasks/types'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/ui/item'
import { useAssignmentTarget } from '../assignment/queries'
import { STATE_LABELS, assignmentState } from '../assignment/status'
import { useAssignmentDetails } from '../assignment/target'
import { useProgramProviderName, useProviderName, useProviderUis } from '../providers'

/**
 * The platform assignment a to-do came from, in the to-do's details (contributed to
 * `tasks.detailSections`): whether it is handed in there, and a way to its details (M09 §7.3),
 * which take the panel's place. Imported as a to-do, or as the assessment the to-do belongs to;
 * other to-dos show nothing.
 */
export default function TaskSubmission({ task, onClose }: TaskDetailSectionProps) {
  const target = useAssignmentTarget(task.program_id, {
    taskId: task.id,
    assessmentId: task.assessment_id,
  })
  if (!target) return null
  return <Card programId={task.program_id} onClose={onClose} target={target} />
}

function Card({
  programId,
  target,
  onClose,
}: {
  programId: string
  target: AssignmentTarget
  onClose: () => void
}) {
  const { open } = useAssignmentDetails()
  const courseId = target.course_id
  const link = useQuery(lmsCourseLinkGetOptions({ path: { course_id: courseId } })).data?.link
  const ui = useProviderUis().get(link?.provider ?? '')
  const linked = useProviderName(link?.provider)
  const bound = useProgramProviderName(programId)
  const Logo = ui?.logo ?? School
  return (
    <Item variant="outline" size="sm">
      <ItemMedia variant="icon">
        <Logo aria-hidden />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{linked ?? bound ?? m.lms_platform()}</ItemTitle>
        {target.status ? <ItemDescription>{status(target)}</ItemDescription> : null}
      </ItemContent>
      <ItemActions>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onClose()
            open(courseId, target.assignment_id)
          }}
        >
          {m.lms_assignment_view()}
        </Button>
      </ItemActions>
    </Item>
  )
}

/** How it stands on the platform, as the sync last read it: "Submitted Nov 20, 18:00". */
function status(t: AssignmentTarget): string {
  const state = assignmentState(
    t.status ? { status: t.status, missing: t.missing } : null,
    t.online,
  )
  return state === 'submitted' && t.submitted_at
    ? m.lms_task_submitted({ time: formatDateTime(new Date(t.submitted_at)) })
    : STATE_LABELS[state]()
}
