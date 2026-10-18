import type { Occurrence } from '@semestra/api-client'
import { CalendarClock } from 'lucide-react'
import type { CardProps } from '@/app/extensions'
import { EmptyState } from '@/components/EmptyState'
import { m } from '@/paraglide/messages'
import { OccurrenceRow } from '../components/OccurrenceRow'
import { dayLabel } from '../labels'
import { useToday } from '../queries'
import { wallDate } from '../time'

/** Deadlines of the next 7 days (assessments, tasks with a due date), grouped by day (M04 §5.5). */
export default function UpcomingCard({ scope }: CardProps) {
  const today = useToday(scope.programId).data
  if (!today) return null
  if (today.upcoming.length === 0) {
    return <EmptyState icon={CalendarClock} title={m.schedule_upcoming_empty()} />
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
