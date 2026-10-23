import type { Task } from '@semestra/api-client'
import { formatDate, formatTime } from '@/lib/format'
import { toWall } from '@/modules/schedule/time'
import { m } from '@/paraglide/messages'

/** A calendar date (`YYYY-MM-DD`) as a local `Date` at noon, so no time zone shifts the day. */
export function localDate(iso: string): Date {
  const [y, mo, d] = iso.split('-').map(Number)
  return new Date(y!, (mo ?? 1) - 1, d ?? 1, 12)
}

/** The wall-clock time now in `timezone`, as a browser-local `Date` (what chrono reads). */
export function wallNow(timezone: string): Date {
  return new Date(toWall(new Date().toISOString(), timezone))
}

function dayDiff(iso: string, today: string): number {
  return Math.round((localDate(iso).getTime() - localDate(today).getTime()) / 86_400_000)
}

/**
 * "Today", "Tomorrow", "Yesterday", a weekday within the week, or the date; plus the time.
 * `today` is the Program's today (`useProgramToday`), the day the backend counts overdue by.
 */
export function dueLabel(task: Pick<Task, 'due_date' | 'due_time'>, today: string): string {
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
