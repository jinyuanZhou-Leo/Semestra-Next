import type { Task } from '@semestra/api-client'
import { formatDate, formatTime, intl } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { dayDate, daysBetween } from '@/lib/day'

/**
 * "Today", "Tomorrow", "Yesterday", a weekday within the week, or the date (without the year in
 * the current year); plus the time.
 * `today` is the Program's today (`useProgramToday`), the day the backend counts overdue by.
 */
export function dueLabel(task: Pick<Task, 'due_date' | 'due_time'>, today: string): string {
  if (!task.due_date) return ''
  const diff = daysBetween(today, task.due_date)
  const date = dayDate(task.due_date)
  let day: string
  if (diff === 0) day = m.tasks_due_today()
  else if (diff === 1) day = m.tasks_due_tomorrow()
  else if (diff === -1) day = m.tasks_due_yesterday()
  else if (diff > 1 && diff < 7) day = intl(Intl.DateTimeFormat, { weekday: 'short' }).format(date)
  else day = formatDate(date, { short: task.due_date.slice(0, 4) === today.slice(0, 4) })
  return task.due_time ? `${day} ${formatTime(`${task.due_date}T${task.due_time}`)}` : day
}
