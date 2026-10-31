import { CalendarDays } from 'lucide-react'
import { useState } from 'react'
import { CardSkeleton } from '@/app/board/CardSkeleton'
import { useElementHeight } from '@/app/board/media'
import type { CardProps } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { type GridDay, WeekGrid } from '../components/WeekGrid'
import { useProgramTimezone } from '../hooks'
import { weekGridItems } from '../occurrence'
import { useOpenOccurrence } from '../open'
import { useCalendarSettings, useOccurrences } from '../queries'
import { isoWeekday, localDay, plusDays, todayIn, wallDate, weekdayName } from '../time'

export const WEEK_SOURCES = ['schedule.meetings', 'schedule.events']

/** Days shown from yesterday on: L fits 5 columns (yesterday to 3 days ahead), XL 7. */
const DAYS = { l: 5, xl: 7 } as const
/** Height of the day header row and of the space above and below the hour lines, in px. */
const CHROME = 52
const HOUR = { min: 14, max: 28 } as const

/**
 * The coming days' classes as a small grid (M04 §5.5), for a term or one course: yesterday,
 * today and the next days, so the week never "ends" on Sunday. The hours span the shown classes
 * only and shrink to fit the card; what still does not fit scrolls.
 */
/** The whole hours the items span, at least four. */
function hourSpan(items: readonly { start: number; end: number }[]): [number, number] {
  const from = Math.floor(Math.min(...items.map((i) => i.start)) / 60) * 60
  const to = Math.ceil(Math.max(...items.map((i) => i.end)) / 60) * 60
  return [from, Math.max(to, from + 4 * 60)]
}

export default function WeekCard({ scope, size }: CardProps) {
  const tz = useProgramTimezone(scope.programId)
  const termId = scope.kind === 'term' ? scope.termId : undefined
  const settings = useCalendarSettings(termId)
  const openOccurrence = useOpenOccurrence(scope.programId)
  const [box, setBox] = useState<HTMLDivElement | null>(null)
  const height = useElementHeight(box)
  const today = tz ? todayIn(tz) : ''
  const count = size === 'xl' ? DAYS.xl : DAYS.l
  // Without weekends, look further ahead so the card still shows `count` days.
  const span = settings.show_weekends ? count : count + 4
  const start = today ? plusDays(today, -1) : ''
  const occurrences = useOccurrences(
    scope.programId,
    {
      start,
      end: start ? plusDays(start, span) : '',
      sources: WEEK_SOURCES,
      ...(termId ? { term_id: termId } : {}),
      ...(scope.kind === 'course' ? { course_ids: [scope.courseId] } : {}),
    },
    Boolean(tz),
  ).data
  if (!occurrences || !tz) return <CardSkeleton />
  const dates = Array.from({ length: span }, (_, i) => plusDays(start, i))
    .filter((date) => settings.show_weekends || isoWeekday(localDay(date)) < 6)
    .slice(0, count)
  const days: GridDay[] = dates.map((date) => {
    const day = localDay(date)
    const weekday = isoWeekday(day)
    return {
      weekday,
      label: date === today ? m.schedule_today() : weekdayName(weekday, 'short'),
      sublabel: String(day.getDate()),
      shaded: occurrences.breaks.some((b) => b.start_date <= date && date <= b.end_date),
      today: date === today,
    }
  })
  // The grid places items by weekday; at most 7 consecutive days are shown, so each weekday is
  // one date.
  const shown = new Set(dates)
  const items = weekGridItems(
    occurrences.items.filter((o) => shown.has(wallDate(o.start_at, tz))),
    tz,
    (o) => {
      const open = openOccurrence(o)
      if (open) open()
    },
  )
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
  const [from, to] = hourSpan(items)
  const hours = (to - from) / 60
  const fit = height > 0 ? Math.floor((height - CHROME) / hours) : HOUR.max
  return (
    <div ref={setBox} className="h-full scroll-fade overflow-y-auto">
      <WeekGrid
        days={days}
        items={items}
        dayStart={from}
        dayEnd={to}
        hourHeight={Math.min(HOUR.max, Math.max(HOUR.min, fit))}
        compact
        hideCancelled={settings.cancelled_display === 'hide'}
      />
    </div>
  )
}
