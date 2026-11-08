import type { Occurrence } from '@semestra/api-client'
import { subjectColor } from '@/lib/subject-color'
import type { GridItem } from './components/WeekGrid'
import { minutes } from './components/WeekGrid'
import { isoWeekday, localDay, toWall } from './time'

/** The course's color; items without one (personal events) use the neutral palette slot. */
export function occurrenceColor(o: Pick<Occurrence, 'color_ref'>): string {
  return o.color_ref ? subjectColor(o.color_ref) : 'var(--subject-12)'
}

export const isMeeting = (o: Occurrence) => o.source === 'schedule.meetings'
export const isOneOff = (o: Occurrence) => o.source === 'schedule.events'

/**
 * Timed items of one week as grid blocks (week card, export). All-day items and finished tasks
 * are left out.
 */
export function weekGridItems(
  items: readonly Occurrence[],
  tz: string,
  onClick?: (o: Occurrence) => void,
): GridItem[] {
  return items
    .filter((o) => !o.all_day && o.status !== 'done')
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

export function weekOf<W extends { start_date: string; end_date: string }>(
  weeks: readonly W[],
  day: string,
): W | undefined {
  return weeks.find((w) => w.start_date <= day && day <= w.end_date)
}
