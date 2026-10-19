import type { Task } from '@semestra/api-client'
import { formatDate, formatTime } from '@/lib/format'
import { m } from '@/paraglide/messages'

/** A local calendar date from an ISO date without a time zone shift. */
function localDate(iso: string): Date {
  const [y, mo, d] = iso.split('-').map(Number)
  return new Date(y!, (mo ?? 1) - 1, d ?? 1)
}

function dayDiff(iso: string, today: Date): number {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((localDate(iso).getTime() - start.getTime()) / 86_400_000)
}

/** "Today", "Tomorrow", "Yesterday", a weekday within the week, or the date; plus the time. */
export function dueLabel(task: Pick<Task, 'due_date' | 'due_time'>, today = new Date()): string {
  if (!task.due_date) return ''
  const diff = dayDiff(task.due_date, today)
  const date = localDate(task.due_date)
  let day: string
  if (diff === 0) day = m.tasks_due_today()
  else if (diff === 1) day = m.tasks_due_tomorrow()
  else if (diff === -1) day = m.tasks_due_yesterday()
  else if (diff > 1 && diff < 7) day = date.toLocaleDateString(undefined, { weekday: 'short' })
  else day = formatDate(date)
  return task.due_time ? `${day} ${formatTime(`${task.due_date}T${task.due_time}`)}` : day
}
