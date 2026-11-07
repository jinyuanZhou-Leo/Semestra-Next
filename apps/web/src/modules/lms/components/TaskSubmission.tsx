import type { AssignmentOut, Task } from '@semestra/api-client'
import { lmsAssignmentListOptions, lmsCourseLinkGetOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, School } from 'lucide-react'
import { formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/ui/item'
import { useProviderName, useProviderUis } from '../providers'

/**
 * The platform assignment a to-do came from, in the to-do's details (contributed to
 * `tasks.detailSections`): whether it is handed in there, and a link to it. Imported as a to-do,
 * or as the assessment the to-do belongs to; other to-dos show nothing.
 */
export default function TaskSubmission({ task }: { task: Task }) {
  const courseId = task.course_id ?? ''
  const link = useQuery({
    ...lmsCourseLinkGetOptions({ path: { course_id: courseId } }),
    enabled: courseId !== '',
  }).data?.link
  const assignments = useQuery({
    ...lmsAssignmentListOptions({ path: { course_id: courseId } }),
    enabled: Boolean(link),
  }).data
  const ui = useProviderUis().get(link?.provider ?? '')
  const provider = useProviderName(link?.provider) ?? ''
  const assignment = assignments?.items.find((a) =>
    a.imported_as.some(
      (t) =>
        (t.kind === 'task' && t.id === task.id) ||
        (t.kind === 'assessment' && t.id === task.assessment_id),
    ),
  )
  if (!link || !assignment) return null
  const Logo = ui?.logo ?? School
  return (
    <Item variant="outline" size="sm">
      <ItemMedia variant="icon">
        <Logo aria-hidden />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{provider}</ItemTitle>
        <ItemDescription>{status(assignment)}</ItemDescription>
      </ItemContent>
      {assignment.web_url ? (
        <ItemActions>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- labelled by the button's text
              <a href={assignment.web_url} target="_blank" rel="noreferrer" />
            }
          >
            {m.lms_open_in({ provider })}
            <ExternalLink aria-hidden />
          </Button>
        </ItemActions>
      ) : null}
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
