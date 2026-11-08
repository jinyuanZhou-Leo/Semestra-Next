import type { Occurrence } from '@semestra/api-client'
import { tasksItemComplete, tasksItemUpdate } from '@semestra/api-client'

/** What the `tasks.due` calendar source lets the calendar do with its items (M05 §4). */

export function completeFromCalendar(occurrence: Occurrence, completed: boolean) {
  return tasksItemComplete({
    path: { task_id: occurrence.ref.id },
    body: { completed },
    throwOnError: true,
  })
}

/** An assessment's task takes its date from the gradebook, so only the others move. */
export const rescheduleFromCalendar = {
  allowed: (occurrence: Occurrence) => !occurrence.meta?.assessment_id,
  save: (occurrence: Occurrence, due: { date: string; time: string | null }) =>
    tasksItemUpdate({
      path: { task_id: occurrence.ref.id },
      body: { due_date: due.date, due_time: due.time },
      throwOnError: true,
    }),
}
