import type { Occurrence } from '@semestra/api-client'
import { useExtensions } from '@/app/registry'
import { m } from '@/paraglide/messages'
import { TASK_LINKS, type TaskLink } from '../types'

/**
 * "Open in gradebook" for an assessment's to-do, "Open in to-dos" for the rest: where the
 * calendar's details take a to-do (`calendarSources` `OpenLabel`).
 */
export function CalendarOpenLabel({ occurrence }: { programId: string; occurrence: Occurrence }) {
  return occurrence.meta?.assessment_id ? m.tasks_open_in_gradebook() : m.tasks_open_in_tasks()
}

/**
 * A to-do's links (`tasks.links`: its assignment's details) under the calendar's details of its
 * due date, which close for what a link opens.
 */
export function CalendarTaskLinks({
  programId,
  occurrence,
  close,
}: {
  programId: string
  occurrence: Occurrence
  close: () => void
}) {
  const links = useExtensions<TaskLink>(TASK_LINKS)
  const task = {
    id: occurrence.ref.id,
    program_id: programId,
    assessment_id: occurrence.meta?.assessment_id ?? null,
  }
  return links.map((link) => (
    <link.Button key={link.id} task={task} as="button" className="mt-1 w-full" onOpen={close} />
  ))
}
