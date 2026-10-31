import type { Occurrence } from '@semestra/api-client'
import { CalendarCheck } from 'lucide-react'
import { Fragment } from 'react'
import { CardSkeleton } from '@/app/board/CardSkeleton'
import type { CardProps } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { OccurrenceRow } from '../components/OccurrenceRow'
import { countdown } from '../countdown'
import { useNow } from '@/lib/now'
import { useOpenOccurrence } from '../open'
import { useToday } from '../queries'

function endOf(o: Occurrence): number {
  return new Date(o.end_at ?? o.start_at).getTime()
}

/**
 * Today's classes and events (M04 §5.5): a timeline with a "now" line and a countdown to the next
 * class. On a term board only that term's classes are listed.
 */
export default function TodayCard({ scope, size }: CardProps) {
  const today = useToday(scope.programId).data
  const now = useNow()
  const openOccurrence = useOpenOccurrence(scope.programId)
  if (!today) return <CardSkeleton />
  const termId = scope.kind === 'term' ? scope.termId : undefined
  const items = today.items.filter((o) => !termId || !o.meta?.term_id || o.meta.term_id === termId)
  if (items.length === 0) {
    return (
      <Empty className="border-0 p-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarCheck aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{m.schedule_today_empty()}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }
  const next = items.find(
    (o) => o.kind === 'class' && o.status !== 'cancelled' && new Date(o.start_at).getTime() > now,
  )
  // The now line goes before the first timed item still to finish, or after the last one.
  const upcoming = items.findIndex((o) => !o.all_day && endOf(o) > now)
  const nowIndex = upcoming !== -1 ? upcoming : items.some((o) => !o.all_day) ? items.length : -1
  const compact = size !== 'xl'
  return (
    <div className="flex h-full flex-col gap-2">
      {next ? (
        <p className="flex min-w-0 gap-1.5 text-sm">
          <span className="shrink-0 text-muted-foreground">{m.schedule_next_class()}</span>
          <span className="truncate font-medium">{next.title}</span>
          <span className="shrink-0 text-muted-foreground">{countdown(next.start_at, now)}</span>
        </p>
      ) : null}
      <ol className="min-h-0 flex-1 scroll-fade overflow-y-auto">
        {items.map((o, i) => (
          <Fragment key={o.id}>
            {i === nowIndex ? <NowLine /> : null}
            <li>
              <OccurrenceRow
                occurrence={o}
                timezone={today.timezone}
                compact={compact}
                past={!o.all_day && endOf(o) <= now}
                onClick={openOccurrence(o)}
              />
            </li>
          </Fragment>
        ))}
        {nowIndex === items.length ? <NowLine /> : null}
      </ol>
    </div>
  )
}

function NowLine() {
  return (
    <li aria-label={m.schedule_now()} className="flex items-center gap-2 py-0.5">
      <span className="size-2 rounded-full bg-destructive" />
      <span className="h-px flex-1 bg-destructive" />
    </li>
  )
}
