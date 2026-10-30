import type { Occurrence } from '@semestra/api-client'
import { CalendarClock } from 'lucide-react'
import { CardSkeleton } from '@/app/board/CardSkeleton'
import type { CardProps } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { OccurrenceRow } from '../components/OccurrenceRow'
import { dayLabel } from '../labels'
import { useToday } from '../queries'
import { wallDate } from '../time'

/** Deadlines of the next 7 days (assessments, tasks with a due date), grouped by day (M04 §5.5). */
export default function UpcomingCard({ scope }: CardProps) {
  const today = useToday(scope.programId).data
  if (!today) return <CardSkeleton />
  if (today.upcoming.length === 0) {
    return (
      <Empty className="border-0 p-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarClock aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{m.schedule_upcoming_empty()}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }
  const groups = new Map<string, Occurrence[]>()
  for (const o of today.upcoming) {
    const day = wallDate(o.start_at, today.timezone)
    groups.set(day, [...(groups.get(day) ?? []), o])
  }
  return (
    <div className="h-full space-y-3 overflow-y-auto">
      {[...groups].map(([day, items]) => (
        <section key={day}>
          <h3 className="px-2 text-xs font-medium text-muted-foreground">
            {day === today.day ? m.schedule_today() : dayLabel(day)}
          </h3>
          <ul>
            {items.map((o) => (
              <li key={o.id}>
                <OccurrenceRow occurrence={o} timezone={today.timezone} compact />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
