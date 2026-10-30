import { MapPin } from 'lucide-react'
import { CardSkeleton } from '@/app/board/CardSkeleton'
import type { CardProps } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { countdown } from '../countdown'
import { useNow } from '@/lib/now'
import { useProgramTimezone } from '../hooks'
import { dayLabel, timeRange } from '../labels'
import { useOccurrences } from '../queries'
import { plusDays, todayIn, wallDate } from '../time'

/** When and where this course meets next (M04 §5.5). Looks two weeks ahead. */
export default function NextCard({ scope }: CardProps) {
  const tz = useProgramTimezone(scope.programId)
  const now = useNow()
  const start = tz ? todayIn(tz) : ''
  const data = useOccurrences(
    scope.programId,
    {
      start,
      end: start ? plusDays(start, 14) : '',
      sources: ['schedule.meetings'],
      course_ids: scope.kind === 'course' ? [scope.courseId] : [],
    },
    Boolean(tz) && scope.kind === 'course',
  ).data
  if (!data || !tz) return <CardSkeleton />
  const next = data.items.find(
    (o) => o.status !== 'cancelled' && new Date(o.end_at ?? o.start_at).getTime() > now,
  )
  if (!next) return <p className="text-sm text-muted-foreground">{m.schedule_next_none()}</p>
  const day = wallDate(next.start_at, tz)
  return (
    <div className="space-y-0.5 text-sm">
      <p className="font-medium">
        {day === todayIn(tz) ? m.schedule_today() : dayLabel(day)} · {timeRange(next, tz)}
      </p>
      <p className="truncate text-muted-foreground">
        {next.type_code ? `${next.type_code} · ` : ''}
        {new Date(next.start_at).getTime() > now ? countdown(next.start_at, now) : m.schedule_now()}
      </p>
      {next.location ? (
        <p className="flex items-center gap-1 truncate text-muted-foreground">
          <MapPin aria-hidden className="size-3 shrink-0" />
          {next.location}
        </p>
      ) : null}
    </div>
  )
}
