import type { CSSProperties, ReactNode } from 'react'
import type { Occurrence } from '@semestra/api-client'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { CalendarCheck, ChevronLeft, ChevronRight, MapPin } from 'lucide-react'
import { useRef } from 'react'
import type { PageProps } from '@/app/extensions'
import { MobileList, MobilePage, MobileSection } from '@/app/mobile/MobilePage'
import { dayDate, plusDays, weekStartOf } from '@/lib/day'
import { firstDayOfWeek, intl } from '@/lib/format'
import { useNow } from '@/hooks/use-now'
import { cn } from '@/lib/utils'
import { TodayTasks } from '@/modules/tasks/mobile/TodayTasks'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Skeleton } from '@/ui/skeleton'
import { endOf, nowLine } from '../now-line'
import { occurrenceColor } from '../occurrence'
import { TodaySubtitle } from '../components/TodaySubtitle'
import { longDayLabel, weekLabel } from '../labels'
import { useOccurrences, useToday } from '../queries'
import { wallDate } from '../time'

/**
 * The Today page on a phone (M17): a strip of the week's days on top, then one list instead of
 * the board — the day's classes and events (with a line at the current time today), then
 * the tasks to check off. Another day (`?date=`) shows
 * that day's classes, events and deadlines. The board's cards stay on the desktop.
 */
export default function TodayAgenda({ scope }: PageProps) {
  const { programId } = scope
  const today = useToday(programId).data
  const search = useSearch({ strict: false }) as { date?: string }
  const day = search.date ?? today?.day
  const isToday = !search.date || search.date === today?.day
  return (
    <MobilePage
      title={isToday ? m.schedule_today() : day ? dayTitle(day) : ''}
      subtitle={
        isToday ? (
          <TodaySubtitle scope={scope} />
        ) : day ? (
          <DaySubtitle programId={programId} day={day} />
        ) : null
      }
    >
      {today && day ? (
        <WeekStrip programId={programId} today={today.day} day={day} timezone={today.timezone} />
      ) : (
        <div className="px-4">
          <Skeleton className="h-16 rounded-2xl" />
        </div>
      )}
      {isToday ? (
        <>
          <TodayClasses programId={programId} />
          <TodayTasks programId={programId} />
        </>
      ) : day && today ? (
        <DayAgenda programId={programId} day={day} timezone={today.timezone} />
      ) : null}
    </MobilePage>
  )
}

const dayTitle = (day: string) =>
  intl(Intl.DateTimeFormat, { month: 'long', day: 'numeric' }).format(dayDate(day))

/** The weekday and the term week of a day other than today. */
function DaySubtitle({ programId, day }: { programId: string; day: string }) {
  const start = weekStartOf(day, firstDayOfWeek())
  const week = useOccurrences(programId, { start, end: plusDays(start, 7) }).data?.weeks.find(
    (w) => w.start_date <= day && day <= w.end_date,
  )
  const weekday = intl(Intl.DateTimeFormat, { weekday: 'long' }).format(dayDate(day))
  return [weekday, week?.number != null ? weekLabel(week.number) : null].filter(Boolean).join(' · ')
}

/**
 * The week of the day shown, one button per day (a dot under days that have something), arrows
 * and a swipe for the weeks before and after, and "Today" to come back.
 */
function WeekStrip({
  programId,
  today,
  day,
  timezone,
}: {
  programId: string
  today: string
  day: string
  timezone: string
}) {
  const navigate = useNavigate()
  const start = weekStartOf(day, firstDayOfWeek())
  const days = Array.from({ length: 7 }, (_, i) => plusDays(start, i))
  const busy = new Set(
    (useOccurrences(programId, { start, end: plusDays(start, 7) }).data?.items ?? [])
      .filter((o) => o.status !== 'cancelled')
      .map((o) => wallDate(o.start_at, timezone)),
  )
  const pick = (next: string) =>
    void navigate({
      to: '.',
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        date: next === today ? undefined : next,
      }),
      replace: true,
    })
  const touch = useRef<number | null>(null)
  const month = intl(Intl.DateTimeFormat, { year: 'numeric', month: 'long' }).format(dayDate(day))
  const weekday = intl(Intl.DateTimeFormat, { weekday: 'narrow' })
  return (
    <div className="px-4">
      <div className="flex items-center gap-1 pb-1">
        <span className="flex-1 px-1 text-sm font-medium">{month}</span>
        {day !== today ? (
          <Button variant="ghost" size="sm" className="text-primary" onClick={() => pick(today)}>
            {m.schedule_today()}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={m.mobile_week_previous()}
          onClick={() => pick(plusDays(day, -7))}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={m.mobile_week_next()}
          onClick={() => pick(plusDays(day, 7))}
        >
          <ChevronRight aria-hidden />
        </Button>
      </div>
      <div
        className="grid touch-pan-y grid-cols-7"
        onTouchStart={(event) => {
          touch.current = event.touches[0]?.clientX ?? null
        }}
        onTouchEnd={(event) => {
          const from = touch.current
          const to = event.changedTouches[0]?.clientX
          touch.current = null
          if (from == null || to == null || Math.abs(to - from) < 48) return
          pick(plusDays(day, to < from ? 7 : -7))
        }}
      >
        {days.map((d) => {
          const selected = d === day
          return (
            <button
              key={d}
              type="button"
              aria-pressed={selected}
              aria-label={longDayLabel(d)}
              className="flex flex-col items-center gap-1 py-1"
              onClick={() => pick(d)}
            >
              <span className="text-[11px] text-muted-foreground">
                {weekday.format(dayDate(d))}
              </span>
              <span
                className={cn(
                  'flex size-9 items-center justify-center rounded-full text-base tabular-nums',
                  selected
                    ? 'bg-primary font-semibold text-primary-foreground'
                    : d === today
                      ? 'font-semibold text-primary'
                      : '',
                )}
              >
                {dayDate(d).getDate()}
              </span>
              <span
                aria-hidden
                className={cn(
                  'size-1 rounded-full',
                  busy.has(d) && !selected ? 'bg-muted-foreground/60' : 'bg-transparent',
                )}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Another day than today: its classes, events and deadlines, read only. */
function DayAgenda({
  programId,
  day,
  timezone,
}: {
  programId: string
  day: string
  timezone: string
}) {
  const start = weekStartOf(day, firstDayOfWeek())
  const week = useOccurrences(programId, { start, end: plusDays(start, 7) })
  if (!week.data || week.isPlaceholderData) {
    return (
      <MobileSection title={m.mobile_day_agenda()}>
        <Skeleton className="h-32 rounded-2xl" />
      </MobileSection>
    )
  }
  const items = week.data.items.filter((o) => wallDate(o.start_at, timezone) === day)
  if (items.length === 0) {
    return (
      <MobileSection title={m.mobile_day_agenda()}>
        <Empty className="rounded-2xl border border-solid border-border p-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarCheck aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{m.mobile_day_empty()}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      </MobileSection>
    )
  }
  return (
    <MobileSection title={m.mobile_day_agenda()}>
      <MobileList label={m.mobile_day_agenda()}>
        {items.map((o) => (
          <AgendaRow key={o.id} programId={programId} occurrence={o} timezone={timezone} />
        ))}
      </MobileList>
    </MobileSection>
  )
}

/** One class, event or deadline: its time, the course's color, what and where; opens the course. */
function AgendaRow({
  programId,
  occurrence: o,
  timezone,
  past = false,
  current = false,
  children,
}: {
  programId: string
  occurrence: Occurrence
  timezone: string
  past?: boolean
  current?: boolean
  children?: ReactNode
}) {
  const time = intl(Intl.DateTimeFormat, { timeStyle: 'short', timeZone: timezone })
  const body = (
    <>
      <div className="w-14 shrink-0 text-right text-sm tabular-nums">
        {o.all_day ? (
          <div className="text-xs text-muted-foreground">{m.schedule_all_day()}</div>
        ) : (
          <>
            <div className="font-medium">{time.format(new Date(o.start_at))}</div>
            {o.end_at && o.end_at !== o.start_at ? (
              <div className="text-xs text-muted-foreground">{time.format(new Date(o.end_at))}</div>
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
        <div className={cn('truncate font-medium', o.status === 'cancelled' && 'line-through')}>
          {o.title}
        </div>
        {o.kind === 'task' || o.type_code || o.location ? (
          <div className="flex items-center gap-1 truncate text-xs text-muted-foreground">
            {o.kind === 'task' ? m.mobile_day_due() : o.type_code}
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
    </>
  )
  const row = cn('relative flex items-center gap-3 px-4 py-3', past && 'opacity-55')
  return (
    <li className="relative" aria-current={current ? 'time' : undefined}>
      {o.course_id ? (
        <Link
          to="/p/$programId/c/$courseId"
          params={{ programId, courseId: o.course_id }}
          className={row}
        >
          {body}
        </Link>
      ) : (
        <div className={row}>{body}</div>
      )}
      {children}
    </li>
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
  // Placement is the desktop card's rule (`nowLine`); a line on the list's outer edge goes just
  // outside it, where the rounded border would clip it.
  const lines = nowLine(items, now)
  const upcoming = items.findIndex((o) => !o.all_day && endOf(o) > now)
  const above = lines.some((l) => l.index === 0 && l.at === 0)
  const below = lines.some((l) => l.index === items.length - 1 && l.at === 1)
  return (
    <MobileSection title={m.mobile_today_classes()}>
      {above ? <NowLine className="mb-2" /> : null}
      <MobileList label={m.mobile_today_classes()}>
        {items.map((o, i) => {
          const past = !o.all_day && endOf(o) <= now
          const next = i === upcoming && new Date(o.start_at).getTime() > now
          return (
            <AgendaRow
              key={o.id}
              programId={programId}
              occurrence={o}
              timezone={today.timezone}
              past={past}
              current={next}
            >
              {lines.map((line) =>
                line.index === i &&
                !(above && i === 0 && line.at === 0) &&
                !(below && line.at === 1) ? (
                  <NowLine
                    key={line.at}
                    className="pointer-events-none absolute inset-x-0 z-10 -translate-y-1/2"
                    style={{ top: `${line.at * 100}%` }}
                  />
                ) : null,
              )}
            </AgendaRow>
          )
        })}
      </MobileList>
      {below ? <NowLine className="mt-2" /> : null}
    </MobileSection>
  )
}

/** The current time: a red dot and line, between the rows or just outside the list. */
function NowLine({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div aria-hidden className={cn('flex items-center', className)} style={style}>
      <span className="size-2 rounded-full bg-destructive" />
      <span className="h-px flex-1 bg-destructive" />
    </div>
  )
}
