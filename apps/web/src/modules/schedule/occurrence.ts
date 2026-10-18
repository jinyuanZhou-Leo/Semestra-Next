import type { CalendarWeek, Occurrence } from '@semestra/api-client'
import { subjectColor } from '@/lib/subject-color'
import { m } from '@/paraglide/messages'
import type { GridItem } from './components/WeekGrid'
import { minutes } from './components/WeekGrid'
import { isoWeekday, localDay, toWall } from './time'

/** The course's color; items without one (personal events) use the neutral palette slot. */
export function occurrenceColor(o: Pick<Occurrence, 'color_ref'>): string {
  return o.color_ref ? subjectColor(o.color_ref) : 'var(--subject-12)'
}

export const isMeeting = (o: Occurrence) => o.source === 'schedule.meetings'
export const isOneOff = (o: Occurrence) => o.source === 'schedule.events'

/** Timed items of one week as grid blocks (week card, export). All-day items are left out. */
export function weekGridItems(
  items: readonly Occurrence[],
  tz: string,
  onClick?: (o: Occurrence) => void,
): GridItem[] {
  return items
    .filter((o) => !o.all_day)
    .map((o) => {
      const start = toWall(o.start_at, tz)
      const end = toWall(o.end_at ?? o.start_at, tz)
      const startMin = minutes(start.slice(11, 16))
      // A deadline is a point in time; give it a visible sliver.
      const endMin = end.slice(0, 10) === start.slice(0, 10) ? minutes(end.slice(11, 16)) : 24 * 60
      return {
        id: o.id,
        weekday: isoWeekday(localDay(start.slice(0, 10))),
        start: startMin,
        end: Math.max(endMin, startMin + 20),
        color: occurrenceColor(o),
        title: o.title,
        subtitle: o.location ?? undefined,
        cancelled: o.status === 'cancelled',
        conflict: (o.meta?.conflicts_with?.length ?? 0) > 0,
        onClick: onClick ? () => onClick(o) : undefined,
      }
    })
}

/** "Week 5" or the break's name for a week of the response. */
export function calendarWeekLabel(week: Pick<CalendarWeek, 'number' | 'break_name'>): string {
  if (week.number != null) {
    return week.break_name
      ? `${m.schedule_week_number({ number: week.number })} · ${week.break_name}`
      : m.schedule_week_number({ number: week.number })
  }
  return week.break_name ?? ''
}

export function weekOf<W extends { start_date: string; end_date: string }>(
  weeks: readonly W[],
  day: string,
): W | undefined {
  return weeks.find((w) => w.start_date <= day && day <= w.end_date)
}
