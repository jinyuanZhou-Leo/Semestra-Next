import { CalendarClock, MapPin } from 'lucide-react'
import { useNow } from '@/hooks/use-now'
import { MobileList, MobileSection } from '@/app/mobile/MobilePage'
import { plusDays } from '@/lib/day'
import { intl } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Skeleton } from '@/ui/skeleton'
import { useOccurrences, useToday } from '../queries'
import { wallDate } from '../time'

/**
 * A course's coming classes and events (the next seven days) on its phone overview (M17 §4.1), the
 * next one first. Cancelled ones are struck through.
 */
export default function CourseClassesSection({
  programId,
  courseId,
}: {
  programId: string
  courseId: string
}) {
  const today = useToday(programId).data
  const now = useNow()
  const occurrences = useOccurrences(
    programId,
    {
      start: today?.day ?? '',
      end: plusDays(today?.day ?? '2000-01-01', 7),
      course_ids: [courseId],
      kinds: ['class', 'event'],
    },
    !!today,
  )
  const items = (occurrences.data?.items ?? []).filter(
    (o) => new Date(o.end_at ?? o.start_at).getTime() > now,
  )
  if (!today || !occurrences.data) {
    return (
      <MobileSection title={m.mobile_course_classes()}>
        <Skeleton className="h-24 rounded-2xl" />
      </MobileSection>
    )
  }
  const time = intl(Intl.DateTimeFormat, { timeStyle: 'short', timeZone: today.timezone })
  const weekday = intl(Intl.DateTimeFormat, { weekday: 'short', timeZone: 'UTC' })
  return (
    <MobileSection title={m.mobile_course_classes()}>
      {items.length === 0 ? (
        <Empty className="rounded-2xl border border-solid border-border p-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarClock aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{m.mobile_course_no_classes()}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <MobileList label={m.mobile_course_classes()}>
          {items.map((o) => {
            const day = wallDate(o.start_at, today.timezone)
            const range = o.all_day
              ? m.schedule_all_day()
              : `${time.format(new Date(o.start_at))}${o.end_at && o.end_at !== o.start_at ? `–${time.format(new Date(o.end_at))}` : ''}`
            return (
              <li key={o.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex w-10 shrink-0 flex-col items-center leading-tight">
                  <span className="text-[11px] text-muted-foreground">
                    {day === today.day
                      ? m.schedule_today()
                      : weekday.format(new Date(`${day}T12:00:00Z`))}
                  </span>
                  <span className="font-heading text-lg font-semibold tabular-nums">
                    {Number(day.slice(8, 10))}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      'truncate font-medium',
                      o.status === 'cancelled' && 'line-through',
                    )}
                  >
                    {o.kind === 'class' ? (o.type_code ?? o.title) : o.title}
                  </div>
                  <div className="flex items-center gap-1 truncate text-xs text-muted-foreground tabular-nums">
                    {range}
                    {o.location ? (
                      <>
                        <MapPin aria-hidden className="ml-1 size-3 shrink-0" />
                        <span className="truncate">{o.location}</span>
                      </>
                    ) : null}
                  </div>
                </div>
              </li>
            )
          })}
        </MobileList>
      )}
    </MobileSection>
  )
}
