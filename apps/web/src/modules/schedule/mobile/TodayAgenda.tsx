import type { CSSProperties, ReactNode } from 'react'
import type { Occurrence } from '@semestra/api-client'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { CalendarCheck, ChevronLeft, ChevronRight, MapPin } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { PageProps } from '@/app/extensions'
import { MobileList, MobilePage, MobileSection } from '@/app/mobile/MobilePage'
import { dayDate, daysBetween, parseDay, plusDays, weekStartOf } from '@/lib/day'
import { firstDayOfWeek, intl } from '@/lib/format'
import { useNow } from '@/hooks/use-now'
import { cn } from '@/lib/utils'
import { TaskSections } from '@/modules/tasks/mobile/TaskSections'
import { TodayTasks } from '@/modules/tasks/mobile/TodayTasks'
import { useTasksDueBetween } from '@/modules/tasks/queries'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Carousel, type CarouselApi, CarouselContent, CarouselItem } from '@/ui/carousel'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Skeleton } from '@/ui/skeleton'
import { endOf, nowLine } from '../now-line'
import { occurrenceColor } from '../occurrence'
import { TodaySubtitle } from '../components/TodaySubtitle'
import { longDayLabel, weekLabel } from '../labels'
import { useOccurrences, useToday } from '../queries'
import { wallDate } from '../time'

/**
 * The Today page on a phone (M17): a strip of weeks on top, then one list instead of the board —
 * the day's classes and events (with a line at the current time today), then its tasks to check
 * off. Another day (`?date=`) shows that day's classes and events, and the tasks due on it. The
 * board's cards stay on the desktop.
 */
export default function TodayAgenda({ scope }: PageProps) {
  const { programId } = scope
  const today = useToday(programId).data
  const search = useSearch({ strict: false }) as { date?: string }
  // The address can be edited or shared: a date that is not a real day counts as none.
  const asked = search.date && parseDay(search.date) ? search.date : undefined
  const day = asked ?? today?.day
  const isToday = !asked || asked === today?.day
  return (
    <MobilePage
      title={isToday || !asked ? m.schedule_today() : dayTitle(asked)}
      subtitle={
        isToday || !asked ? (
          <TodaySubtitle scope={scope} />
        ) : (
          <DaySubtitle programId={programId} day={asked} />
        )
      }
    >
      {today && day ? (
        <WeekStrip programId={programId} today={today.day} day={day} timezone={today.timezone} />
      ) : (
        <WeekStripSkeleton />
      )}
      {isToday || !asked ? (
        <>
          <TodayClasses programId={programId} />
          <TodayTasks programId={programId} />
        </>
      ) : today ? (
        <DayAgenda programId={programId} day={asked} timezone={today.timezone} />
      ) : (
        <DayAgendaSkeleton />
      )}
    </MobilePage>
  )
}

const dayTitle = (day: string) =>
  intl(Intl.DateTimeFormat, { month: 'long', day: 'numeric' }).format(dayDate(day))

const weekOf = (day: string) => weekStartOf(day, firstDayOfWeek())

/** The calendar of the week starting `start`, as the strip and the day's list read it. */
function useWeek(programId: string, start: string, enabled = true) {
  const week = useOccurrences(programId, { start, end: plusDays(start, 7) }, enabled)
  // Another week's data kept while this one loads is not this week's.
  return week.isPlaceholderData ? undefined : week.data
}

/**
 * What a day shows from the calendar: its classes, events and unfinished deadlines (listed with
 * the tasks). The strip's dot under a day and the day's list both follow it.
 */
function onDay(items: readonly Occurrence[], day: string, timezone: string): Occurrence[] {
  return items.filter(
    (o) => wallDate(o.start_at, timezone) === day && !(o.kind === 'task' && o.status === 'done'),
  )
}

/** The weekday and the term week of a day other than today, shown once both are known. */
function DaySubtitle({ programId, day }: { programId: string; day: string }) {
  const data = useWeek(programId, weekOf(day))
  if (!data) return null
  const week = data.weeks.find((w) => w.start_date <= day && day <= w.end_date)
  const weekday = intl(Intl.DateTimeFormat, { weekday: 'long' }).format(dayDate(day))
  return [weekday, week?.number != null ? weekLabel(week.number) : null].filter(Boolean).join(' · ')
}

/** Weeks the strip can be swiped to on either side of today's (a year). */
const WEEKS = 52

/**
 * Weeks to browse (Embla through shadcn's `Carousel`: it follows the finger and snaps), one
 * button per day with a dot under days that have something. Browsing does not change the day
 * shown below; tapping a day does. "Today" comes back.
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
  const home = weekOf(today)
  const offset = (week: string) => daysBetween(home, week) / 7
  const selected = offset(weekOf(day))
  // Fixed once: a day opened from a link further away than a year widens it.
  const [range] = useState(() => ({
    from: Math.min(-WEEKS, selected),
    to: Math.max(WEEKS, selected),
  }))
  const weeks = Array.from({ length: range.to - range.from + 1 }, (_, i) =>
    plusDays(home, (range.from + i) * 7),
  )
  const index = (week: string) => offset(week) - range.from
  const [api, setApi] = useState<CarouselApi>()
  const [shown, setShown] = useState(() => index(weekOf(day)))
  useEffect(() => {
    if (!api) return
    const select = () => setShown(api.selectedScrollSnap())
    api.on('select', select)
    return () => void api.off('select', select)
  }, [api])
  // Picking a day in another week ("Today") brings its week into view.
  const selectedIndex = index(weekOf(day))
  useEffect(() => {
    api?.scrollTo(selectedIndex)
  }, [api, selectedIndex])
  const shownWeek = weeks[shown] ?? weekOf(day)
  // The shown week's tasks load with it, so tapping one of its days shows them at once.
  useTasksDueBetween(programId, shownWeek, plusDays(shownWeek, 6))
  const pick = (next: string) =>
    void navigate({
      to: '.',
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        date: next === today ? undefined : next,
      }),
      replace: true,
    })
  const month = intl(Intl.DateTimeFormat, { year: 'numeric', month: 'long' }).format(
    dayDate(weekOf(day) === shownWeek ? day : shownWeek),
  )
  return (
    <div className="px-4">
      <div className="flex h-9 items-center gap-1">
        <span className="flex-1 px-1 text-sm font-medium">{month}</span>
        {day !== today || shownWeek !== home ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-primary"
            onClick={() => {
              pick(today)
              api?.scrollTo(index(home))
            }}
          >
            {m.schedule_today()}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={m.mobile_week_previous()}
          onClick={() => api?.scrollPrev()}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={m.mobile_week_next()}
          onClick={() => api?.scrollNext()}
        >
          <ChevronRight aria-hidden />
        </Button>
      </div>
      <Carousel setApi={setApi} opts={{ startIndex: shown }} aria-label={month}>
        <CarouselContent>
          {weeks.map((start, i) => (
            // Only the shown week can be reached with the keyboard; its neighbours are drawn for
            // the swipe, the rest stay empty.
            <CarouselItem key={start} inert={i !== shown}>
              {Math.abs(i - shown) <= 1 ? (
                <WeekDays
                  programId={programId}
                  start={start}
                  today={today}
                  day={day}
                  timezone={timezone}
                  onPick={pick}
                />
              ) : (
                <div className="h-[72px]" />
              )}
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>
    </div>
  )
}

const WEEK_GRID = 'grid grid-cols-7'
const DAY_CELL = 'flex flex-col items-center gap-1 py-1'
const WEEKDAY = 'h-4 text-[11px] leading-4 text-muted-foreground'

function WeekDays({
  programId,
  start,
  today,
  day,
  timezone,
  onPick,
}: {
  programId: string
  start: string
  today: string
  day: string
  timezone: string
  onPick: (day: string) => void
}) {
  const items = useWeek(programId, start)?.items
  const weekday = intl(Intl.DateTimeFormat, { weekday: 'narrow' })
  return (
    <div className={WEEK_GRID}>
      {Array.from({ length: 7 }, (_, i) => plusDays(start, i)).map((d) => {
        const selected = d === day
        const busy = items ? onDay(items, d, timezone).length > 0 : false
        return (
          <button
            key={d}
            type="button"
            aria-pressed={selected}
            aria-label={longDayLabel(d)}
            className={DAY_CELL}
            onClick={() => onPick(d)}
          >
            <span className={WEEKDAY}>{weekday.format(dayDate(d))}</span>
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
                busy && !selected ? 'bg-muted-foreground/60' : 'bg-transparent',
              )}
            />
          </button>
        )
      })}
    </div>
  )
}

/** The strip's shape while today is not known yet, so nothing moves when it arrives. */
function WeekStripSkeleton() {
  return (
    <div className="px-4" aria-hidden>
      <div className="flex h-9 items-center px-1">
        <Skeleton className="h-4 w-24" />
      </div>
      <div className={WEEK_GRID}>
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className={DAY_CELL}>
            <span className={WEEKDAY} />
            <Skeleton className="size-9 rounded-full" />
            <span className="size-1" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** One row's height while a day loads (a row is a time, a bar and two lines). */
function DayAgendaSkeleton() {
  return (
    <MobileSection title={m.mobile_today_classes()}>
      <Skeleton className="h-[62px] rounded-2xl" />
    </MobileSection>
  )
}

/**
 * Another day than today, laid out like today: its classes and events, then the tasks due on it,
 * which check off and open as on today.
 */
function DayAgenda({
  programId,
  day,
  timezone,
}: {
  programId: string
  day: string
  timezone: string
}) {
  const start = weekOf(day)
  const week = useWeek(programId, start)
  const tasks = useTasksDueBetween(programId, start, plusDays(start, 6)).data?.items
  if (!week || !tasks) return <DayAgendaSkeleton />
  const items = onDay(week.items, day, timezone).filter((o) => o.kind !== 'task')
  const due = tasks.filter((t) => t.due_date === day)
  if (items.length === 0 && due.length === 0) {
    return (
      <MobileSection title={m.mobile_today_classes()}>
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
    <>
      {items.length > 0 ? (
        <MobileSection title={m.mobile_today_classes()}>
          <MobileList label={m.mobile_today_classes()}>
            {items.map((o) => (
              <AgendaRow key={o.id} programId={programId} occurrence={o} timezone={timezone} />
            ))}
          </MobileList>
        </MobileSection>
      ) : null}
      {due.length > 0 ? (
        <TaskSections
          programId={programId}
          groups={[{ id: 'due', title: m.mobile_day_due(), tasks: due }]}
        />
      ) : null}
    </>
  )
}

/** One class or event: its time, the course's color, what and where; opens the course. */
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
