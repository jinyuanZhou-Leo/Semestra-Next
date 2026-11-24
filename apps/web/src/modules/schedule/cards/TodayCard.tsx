import { CalendarCheck } from 'lucide-react'
import { CardSkeleton } from '@/app/board/CardSkeleton'
import type { CardProps } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { ScrollArea } from '@/ui/scroll-area'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { OccurrenceRow } from '../components/OccurrenceRow'
import { countdown } from '../countdown'
import { endOf, nowLine } from '../now-line'
import { useNow } from '@/hooks/use-now'
import { useOpenOccurrence } from '../open'
import { useToday } from '../queries'

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
  const lines = nowLine(items, now)
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
      <ScrollArea className="scroll-area-fade min-h-0 flex-1">
        <ol className="py-2">
          {items.map((o, i) => (
            <li key={o.id} className="relative">
              <OccurrenceRow
                occurrence={o}
                timezone={today.timezone}
                compact={compact}
                past={!o.all_day && endOf(o) <= now}
                onClick={openOccurrence(o)}
              />
              {lines.map((line) =>
                line.index === i ? <NowLine key={line.at} at={line.at} /> : null,
              )}
            </li>
          ))}
        </ol>
      </ScrollArea>
    </div>
  )
}

function NowLine({ at }: { at: number }) {
  return (
    <div
      className="pointer-events-none absolute inset-x-1 flex -translate-y-1/2 items-center transition-[top] duration-500"
      style={{ top: `${at * 100}%` }}
    >
      <span aria-hidden className="size-2 rounded-full bg-destructive" />
      <hr aria-label={m.schedule_now()} className="h-px flex-1 border-0 bg-destructive" />
    </div>
  )
}
