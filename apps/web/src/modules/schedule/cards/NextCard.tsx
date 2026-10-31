import { CalendarCheck, MapPin } from 'lucide-react'
import { CardSkeleton } from '@/app/board/CardSkeleton'
import type { CardProps } from '@/app/extensions'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { countdown } from '../countdown'
import { useNow } from '@/lib/now'
import { useProgramTimezone } from '../hooks'
import { dayLabel, timeParts } from '../labels'
import { useOpenOccurrence } from '../open'
import { useOccurrences } from '../queries'
import { plusDays, todayIn, wallDate } from '../time'

const SOON = 60 * 60_000

/**
 * When and where this course meets next (M04 §5.5), looking two weeks ahead. The start time is
 * the headline; the day, type and countdown frame it, the room sits at the bottom.
 */
export default function NextCard({ scope }: CardProps) {
  const tz = useProgramTimezone(scope.programId)
  const now = useNow()
  const openOccurrence = useOpenOccurrence(scope.programId)
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
  if (!next) {
    return (
      <Empty className="border-0 p-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarCheck aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{m.schedule_next_none()}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }
  const day = wallDate(next.start_at, tz)
  const until = new Date(next.start_at).getTime() - now
  const [from, to] = timeParts(next, tz)
  const open = openOccurrence(next)
  return (
    <button
      type="button"
      onClick={open}
      disabled={!open}
      className="-mx-2 -my-1 flex h-full min-w-0 flex-col rounded-xl px-2 py-1 text-left transition-colors enabled:hover:bg-muted/50"
    >
      <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">{m.schedule_card_next()}</span>
        {until <= 0 ? (
          <Badge className="shrink-0">{m.schedule_now()}</Badge>
        ) : (
          <span className={cn('shrink-0', until < SOON && 'font-medium text-primary')}>
            {countdown(next.start_at, now)}
          </span>
        )}
      </span>
      <span className="mt-1 flex items-baseline gap-1.5 whitespace-nowrap">
        <span className="font-heading text-2xl font-semibold tabular-nums">{from}</span>
        {to ? <span className="truncate text-xs text-muted-foreground">– {to}</span> : null}
      </span>
      <span className="truncate text-sm">
        {day === todayIn(tz) ? m.schedule_today() : dayLabel(day)}
        {next.type_code ? <span className="text-muted-foreground"> · {next.type_code}</span> : null}
      </span>
      {next.location ? (
        <span className="mt-auto flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <MapPin aria-hidden className="size-3 shrink-0" />
          <span className="truncate" title={next.location}>
            {next.location}
          </span>
        </span>
      ) : null}
    </button>
  )
}
