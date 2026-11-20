import type { AssignmentOut } from '@semestra/api-client'
import { lmsAssignmentListOptions, lmsCourseLinkGetOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { School } from 'lucide-react'
import { formatDateTime } from '@/lib/format'
import type { TaskDetailSectionProps } from '@/modules/tasks/types'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/ui/item'
import { useAssignmentOf } from '../assignment/queries'
import { useAssignmentDetails } from '../assignment/target'
import { useProgramProviderName, useProviderName, useProviderUis } from '../providers'

/**
 * The platform assignment a to-do came from, in the to-do's details (contributed to
 * `tasks.detailSections`): whether it is handed in there, and a way to its details (M09 §7.3),
 * which take the panel's place. Imported as a to-do, or as the assessment the to-do belongs to;
 * other to-dos show nothing.
 */
export default function TaskSubmission({ task, onClose }: TaskDetailSectionProps) {
  const assignment = useAssignmentOf(task.program_id, {
    taskId: task.id,
    assessmentId: task.assessment_id,
  })
  if (!assignment) return null
  return <Card programId={task.program_id} onClose={onClose} {...assignment} />
}

function Card({
  programId,
  courseId,
  assignmentId,
  onClose,
}: {
  programId: string
  courseId: string
  assignmentId: string
  onClose: () => void
}) {
  const { open } = useAssignmentDetails()
  const link = useQuery(lmsCourseLinkGetOptions({ path: { course_id: courseId } })).data?.link
  // How it stands on the platform, while the course is linked to it.
  const listed = useQuery({
    ...lmsAssignmentListOptions({ path: { course_id: courseId } }),
    enabled: Boolean(link),
    select: (list) => list.items.find((a) => a.external_id === assignmentId),
  }).data
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
        {listed ? <ItemDescription>{status(listed)}</ItemDescription> : null}
      </ItemContent>
      <ItemActions>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onClose()
            open(courseId, assignmentId)
          }}
        >
          {m.lms_assignment_view()}
        </Button>
      </ItemActions>
    </Item>
  )
}

function status({ submission: s }: AssignmentOut): string {
  if (s?.state === 'graded') return m.lms_task_graded()
  if (s?.submitted_at)
    return m.lms_task_submitted({ time: formatDateTime(new Date(s.submitted_at)) })
  if (s?.missing) return m.lms_task_missing()
  return m.lms_task_unsubmitted()
}
