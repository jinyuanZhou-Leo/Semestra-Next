import type { Occurrence } from '@semestra/api-client'
import { tasksItemComplete, tasksItemUpdate } from '@semestra/api-client'
import type { QueryClient } from '@tanstack/react-query'
import { invalidateTasks } from './queries'

/** What the `tasks.due` calendar source lets the calendar do with its items (M05 §4). */

export async function completeFromCalendar(
  occurrence: Occurrence,
  completed: boolean,
  queryClient: QueryClient,
) {
  await tasksItemComplete({
    path: { task_id: occurrence.ref.id },
    body: { completed },
    throwOnError: true,
  })
  void invalidateTasks(queryClient)
}

/** An assessment's task takes its date from the gradebook, so only the others move. */
export const rescheduleFromCalendar = {
  allowed: (occurrence: Occurrence) => !occurrence.meta?.assessment_id,
  save: async (
    occurrence: Occurrence,
    due: { date: string; time: string | null },
    queryClient: QueryClient,
  ) => {
    await tasksItemUpdate({
      path: { task_id: occurrence.ref.id },
      body: { due_date: due.date, due_time: due.time },
      throwOnError: true,
    })
    void invalidateTasks(queryClient)
  },
}
