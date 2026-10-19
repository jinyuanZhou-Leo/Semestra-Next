import { CalendarDays } from 'lucide-react'
import type { CardProps } from '@/app/extensions'
import { firstDayOfWeek } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { WeekGrid, minutes, weekDays } from '../components/WeekGrid'
import { useProgramTimezone } from '../hooks'
import { weekGridItems } from '../occurrence'
import { useCalendarSettings, useOccurrences } from '../queries'
import { dayInWeek, localDay, plusDays, todayIn, weekStartOf } from '../time'

export const WEEK_SOURCES = ['schedule.meetings', 'schedule.events']

/** This week's classes as a small grid (M04 §5.5), for a term or one course. */
export default function WeekCard({ scope }: CardProps) {
  const tz = useProgramTimezone(scope.programId)
  const termId = scope.kind === 'term' ? scope.termId : undefined
  const settings = useCalendarSettings(termId)
  const start = tz ? weekStartOf(todayIn(tz), firstDayOfWeek()) : ''
  const occurrences = useOccurrences(
    scope.programId,
    {
      start,
      end: start ? plusDays(start, 7) : '',
      sources: WEEK_SOURCES,
      ...(termId ? { term_id: termId } : {}),
      ...(scope.kind === 'course' ? { course_ids: [scope.courseId] } : {}),
    },
    Boolean(tz),
  ).data
  if (!occurrences || !tz) return null
  const items = weekGridItems(occurrences.items, tz)
  if (items.length === 0) {
    return (
      <Empty className="border-0 p-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarDays aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{m.schedule_week_empty()}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }
  const days = weekDays(settings.show_weekends).map((d) => {
    const date = dayInWeek(start, d.weekday)
    const inBreak = occurrences.breaks.some((b) => b.start_date <= date && date <= b.end_date)
    return {
      ...d,
      sublabel: String(localDay(date).getDate()),
      shaded: inBreak,
    }
  })
  return (
    <div className="h-full overflow-y-auto">
      <WeekGrid
        days={days}
        items={items}
        dayStart={minutes(settings.day_start)}
        dayEnd={minutes(settings.day_end)}
        hourHeight={28}
        compact
        hideCancelled={settings.cancelled_display === 'hide'}
      />
    </div>
  )
}
