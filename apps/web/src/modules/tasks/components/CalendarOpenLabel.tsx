import type { Occurrence } from '@semestra/api-client'
import { m } from '@/paraglide/messages'

/**
 * "Open in gradebook" for an assessment's to-do, "Open in to-dos" for the rest: where the
 * calendar's details take a to-do (`calendarSources` `OpenLabel`).
 */
export function CalendarOpenLabel({ occurrence }: { programId: string; occurrence: Occurrence }) {
  return occurrence.meta?.assessment_id ? m.tasks_open_in_gradebook() : m.tasks_open_in_tasks()
}
