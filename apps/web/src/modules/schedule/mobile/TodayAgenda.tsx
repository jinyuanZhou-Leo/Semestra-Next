import type { Occurrence } from '@semestra/api-client'
import { CalendarCheck, MapPin } from 'lucide-react'
import { Fragment } from 'react'
import type { PageProps } from '@/app/extensions'
import { MobileList, MobilePage, MobileSection } from '@/app/mobile/MobilePage'
import { intl } from '@/lib/format'
import { useNow } from '@/lib/now'
import { cn } from '@/lib/utils'
import { TodayTasks } from '@/modules/tasks/mobile/TodayTasks'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Skeleton } from '@/ui/skeleton'
import { occurrenceColor } from '../occurrence'
import { TodaySubtitle } from '../components/TodaySubtitle'
import { useToday } from '../queries'

function endOf(o: Occurrence): number {
  return new Date(o.end_at ?? o.start_at).getTime()
}

/**
 * The Today page on a phone (M17): one list instead of the board — today's classes and events
 * with a line at the current time, then the tasks to check off. The board's cards stay on the
 * desktop.
 */
export default function TodayAgenda({ scope }: PageProps) {
  return (
    <MobilePage title={m.schedule_today()} subtitle={<TodaySubtitle scope={scope} />}>
      <TodayClasses programId={scope.programId} />
      <TodayTasks programId={scope.programId} />
    </MobilePage>
  )
}

function TodayClasses({ programId }: { programId: string }) {
  const today = useToday(programId).data
  const now = useNow()
  if (!today) {
    return (
      <MobileSection title={m.mobile_today_classes()}>
        <Skeleton className="h-32 rounded-2xl" />
      </MobileSection>
    )
  }
  // Deadlines and tasks are in the tasks below, which can be checked off.
  const items = today.items.filter((o) => o.kind === 'class' || o.kind === 'event')
  if (items.length === 0) {
    return (
      <MobileSection title={m.mobile_today_classes()}>
        <Empty className="rounded-2xl border border-solid border-border p-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarCheck aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{m.schedule_today_empty()}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      </MobileSection>
    )
  }
  // The now line goes before the first timed item still to finish, or after the last one; above
  // or below the list when it is not between two rows.
  const upcoming = items.findIndex((o) => !o.all_day && endOf(o) > now)
  const nowIndex = upcoming !== -1 ? upcoming : items.some((o) => !o.all_day) ? items.length : -1
  const time = intl(Intl.DateTimeFormat, { timeStyle: 'short', timeZone: today.timezone })
  return (
    <MobileSection title={m.mobile_today_classes()}>
      {nowIndex === 0 ? <NowLine className="mb-2" /> : null}
      <MobileList label={m.mobile_today_classes()}>
        {items.map((o, i) => {
          const past = !o.all_day && endOf(o) <= now
          const next = i === upcoming && new Date(o.start_at).getTime() > now
          return (
            <Fragment key={o.id}>
              {i === nowIndex && i > 0 ? (
                <li aria-label={m.schedule_now()} className="relative z-10 h-0 border-0">
                  <NowLine className="absolute inset-x-0 -translate-y-1/2" />
                </li>
              ) : null}
              <li
                className={cn('flex items-center gap-3 px-4 py-3', past && 'opacity-55')}
                aria-current={next ? 'time' : undefined}
              >
                <div className="w-14 shrink-0 text-right text-sm tabular-nums">
                  {o.all_day ? (
                    <div className="text-xs text-muted-foreground">{m.schedule_all_day()}</div>
                  ) : (
                    <>
                      <div className="font-medium">{time.format(new Date(o.start_at))}</div>
                      {o.end_at ? (
                        <div className="text-xs text-muted-foreground">
                          {time.format(new Date(o.end_at))}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
                <span
                  aria-hidden
                  className="h-9 w-1 shrink-0 rounded-full"
                  style={{ backgroundColor: occurrenceColor(o) }}
                />
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      'truncate font-medium',
                      o.status === 'cancelled' && 'line-through',
                    )}
                  >
                    {o.title}
                  </div>
                  {o.type_code || o.location ? (
                    <div className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                      {o.type_code}
                      {o.location ? (
                        <>
                          <MapPin aria-hidden className={cn('size-3', o.type_code && 'ml-1')} />
                          {o.location}
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {o.status === 'cancelled' ? (
                  <Badge variant="secondary">{m.schedule_status_cancelled()}</Badge>
                ) : o.status === 'moved' ? (
                  <Badge variant="secondary">{m.schedule_status_moved()}</Badge>
                ) : null}
              </li>
            </Fragment>
          )
        })}
      </MobileList>
      {nowIndex === items.length ? <NowLine className="mt-2" /> : null}
    </MobileSection>
  )
}

/** The current time: a red dot and line, between the rows or just outside the list. */
function NowLine({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('flex items-center', className)}>
      <span className="size-2 rounded-full bg-destructive" />
      <span className="h-px flex-1 bg-destructive" />
    </div>
  )
}
