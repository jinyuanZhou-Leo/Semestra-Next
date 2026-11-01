import type {
  DayHeaderContentArg,
  EventChangeArg,
  EventContentArg,
  EventInput,
  FormatterInput,
} from '@fullcalendar/core'
import zhCnLocale from '@fullcalendar/core/locales/zh-cn'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import listPlugin from '@fullcalendar/list'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import type { Meeting, OneOffEvent, Occurrence, Term } from '@semestra/api-client'
import {
  scheduleEventGetOptions,
  scheduleEventUpdateMutation,
  scheduleExceptionUpsertMutation,
  scheduleMeetingListOptions,
  scheduleMeetingUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ChevronDown,
  ListFilter,
  Plus,
  TriangleAlert,
} from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import type { PageProps } from '@/app/extensions'
import { useCalendarSources } from '@/app/registry'
import { useUiPref } from '@/app/ui-pref'
import { toastError } from '@/lib/errors'
import { firstDayOfWeek, getFormatPreferences } from '@/lib/format'
import { cn } from '@/lib/utils'
import { SEGMENT, SEGMENTED } from '@/lib/segmented'
import { useCourses, useTerms } from '@/modules/academics/queries'
import { m } from '@/paraglide/messages'
import { getLocale } from '@/paraglide/runtime'
import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/ui/sheet'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'
import '../calendar.css'
import { DragChoiceDialog } from '../components/DragChoiceDialog'
import { EventDialog, type EventSlot } from '../components/EventDialog'
import { SHARE_KINDS, ShareDialog, type ShareKind } from '../components/ExportDialog'
import { FilterPanel } from '../components/FilterPanel'
import { MeetingDialog } from '../components/MeetingDialog'
import { MoveDialog, type MoveTarget } from '../components/MoveDialog'
import { OccurrenceDetails } from '../components/OccurrenceDetails'
import { TimetableView } from '../components/TimetableView'
import { type CalendarFilters, DEFAULT_FILTERS, visibleSources } from '../filters'
import { useProgramTimezone } from '../hooks'
import { weekLabel } from '../labels'
import { isMeeting, isOneOff, occurrenceColor, weekOf } from '../occurrence'
import {
  type CalendarNav,
  type CalendarView,
  calendarAnchor,
  invalidateSchedule,
  occurrenceOptions,
  occurrenceRange,
  stepPeriod,
  useCalendarInfo,
  useCalendarSettings,
  useOccurrences,
  useTermMeetings,
} from '../queries'
import { isoDay } from '@/lib/day'
import { hhmm, isoWeekday, markerDay, plusDays, toWall, todayIn, wall } from '../time'

const FC_VIEW: Record<Exclude<CalendarView, 'timetable'>, string> = {
  week: 'timeGridWeek',
  month: 'dayGridMonth',
  list: 'listWeek',
}

// Module constants: FullCalendar resets its view (and reports the dates again) when these change.
const PLUGINS = [dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]
const LOCALES = [zhCnLocale]
const DAY_HEADER_FORMAT = { weekday: 'short' } as const
// Times follow the user's clock preference (M11), like `formatTime` elsewhere.
const TIME_FORMATS = {
  auto: { hour: '2-digit', minute: '2-digit' },
  '12h': { hour: 'numeric', minute: '2-digit', hour12: true },
  '24h': { hour: '2-digit', minute: '2-digit', hour12: false },
} as const satisfies Record<string, FormatterInput>
// The week view draws its day headers like the timetable (weekday, the date under it).
const VIEWS = {
  timeGridWeek: { dayHeaderContent: (arg: DayHeaderContentArg) => <WeekDayHeader arg={arg} /> },
}

/** A week row or column is named after the term week holding most of its days. */
const midWeek = (firstDay: string) => plusDays(firstDay, 3)

/** The term calendar (M04 §5.2). */
export default function CalendarPage({ scope }: PageProps) {
  const termId = scope.kind === 'term' ? scope.termId : ''
  const timezone = useProgramTimezone(scope.programId)
  const term = useTerms(scope.programId).data?.items.find((t) => t.id === termId)
  if (!timezone || !term) return null
  return <TermCalendar programId={scope.programId} term={term} timezone={timezone} />
}

type DragState = {
  occurrence: Occurrence
  start: Date
  end: Date
  revert: () => void
}

function TermCalendar({
  programId,
  term,
  timezone,
}: {
  programId: string
  term: Term
  timezone: string
}) {
  const queryClient = useQueryClient()
  const calendarRef = useRef<FullCalendar>(null)
  const settings = useCalendarSettings(term.id)
  const sources = useCalendarSources()
  const courses = useCourses(programId, term.id).data?.items ?? []
  const weeks = useCalendarInfo(term.id).data?.weeks ?? []
  const [nav, setNav] = useUiPref<CalendarNav | null>('calendar.nav', null, { scope: term.id })
  const [filters, setFilters] = useUiPref<CalendarFilters>('calendar.filters', DEFAULT_FILTERS, {
    scope: term.id,
  })
  const today = todayIn(timezone)
  // FullCalendar gets Program wall-clock times, so its "now" (today, the now line) must be too.
  const now = useCallback(() => toWall(new Date().toISOString(), timezone), [timezone])
  const view: CalendarView = nav?.view ?? settings.default_view
  const anchor = calendarAnchor(nav, term, today)
  // The day the calendar reports showing; until it has drawn, the one it opens on.
  const [shownDate, setShownDate] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  // The first day the view shows, so the week label agrees with the week-number column.
  const [rangeStart, setRangeStart] = useState<string | null>(null)

  const [details, setDetails] = useState<Occurrence | null>(null)
  const [move, setMove] = useState<MoveTarget | null>(null)
  const [meetingEdit, setMeetingEdit] = useState<Meeting | null>(null)
  const [eventEdit, setEventEdit] = useState<{ event?: OneOffEvent; slot?: EventSlot } | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [share, setShare] = useState<ShareKind | null>(null)
  // Only the timetable and the export show meetings; the other views show occurrences, and
  // editing one fetches its meeting or event when asked.
  const termMeetings = useTermMeetings(term.id, view === 'timetable' || share === 'image')
  const meetings = termMeetings.items

  // The meeting or event behind an occurrence, for its editor: fetched when its details open,
  // so "Edit" usually finds it cached.
  const meetingsOf = (o: Occurrence) =>
    queryClient.fetchQuery(
      scheduleMeetingListOptions({
        path: { course_id: o.course_id ?? '' },
        query: { term_id: term.id },
      }),
    )
  const eventOf = (o: Occurrence) =>
    queryClient.fetchQuery(scheduleEventGetOptions({ path: { event_id: o.ref.id } }))
  const showDetails = (o: Occurrence) => {
    setDetails(o)
    if (isMeeting(o) && o.course_id) void meetingsOf(o).catch(() => undefined)
    else if (isOneOff(o)) void eventOf(o).catch(() => undefined)
  }

  const wanted = visibleSources(filters, sources)
  // Worked out from the day shown rather than waiting for the calendar to report its dates, so
  // the first request starts with the page (and matches the page's prefetch).
  const params = (shown: Exclude<CalendarView, 'timetable'>, date: string) => ({
    ...occurrenceRange(shown, date, firstDayOfWeek()),
    term_id: term.id,
    sources: wanted,
  })
  const occurrences = useOccurrences(
    programId,
    params(view === 'timetable' ? 'week' : view, shownDate ?? anchor),
    view !== 'timetable' && wanted.length > 0,
  ).data
  // Once the days shown have loaded, the periods either side load too, so an arrow shows its
  // days at once instead of an empty week first.
  const loadNeighbours = (shown: Exclude<CalendarView, 'timetable'>, date: string) => {
    if (wanted.length === 0) return
    queryClient
      .fetchQuery(occurrenceOptions(programId, params(shown, date)))
      .then(() => {
        for (const step of [-1, 1] as const) {
          void queryClient.prefetchQuery(
            occurrenceOptions(programId, params(shown, stepPeriod(shown, date, step))),
          )
        }
      })
      // The calendar's own query reports errors.
      .catch(() => undefined)
  }
  const showCancelled = filters.showCancelled ?? settings.cancelled_display === 'strike'
  const hidden = new Set(filters.hiddenCourses)
  const items = (wanted.length > 0 ? (occurrences?.items ?? []) : []).filter(
    (o) =>
      (!o.course_id || !hidden.has(o.course_id)) && (showCancelled || o.status !== 'cancelled'),
  )

  const updateEvent = useMutation({ ...scheduleEventUpdateMutation() })
  const upsertException = useMutation({ ...scheduleExceptionUpsertMutation() })
  const updateMeeting = useMutation({ ...scheduleMeetingUpdateMutation() })

  const saveNav = (next: CalendarNav) => {
    if (next.view !== nav?.view || next.date !== nav?.date) setNav(next)
  }
  // The calendar is keyed by its view, so storing the new one is the switch (one mount).
  const changeView = (next: CalendarView) => {
    const date = calendarRef.current?.getApi().getDate()
    saveNav({ view: next, date: date ? isoDay(date) : anchor })
  }

  const fcEvents: EventInput[] = [
    ...items.map((o): EventInput => {
      const editable = isOneOff(o) || (isMeeting(o) && o.status !== 'cancelled')
      return {
        id: o.id,
        title: o.title,
        start: o.all_day ? toWall(o.start_at, timezone).slice(0, 10) : toWall(o.start_at, timezone),
        end: o.end_at
          ? o.all_day
            ? toWall(o.end_at, timezone).slice(0, 10)
            : toWall(o.end_at, timezone)
          : undefined,
        allDay: o.all_day ?? false,
        editable,
        durationEditable: editable,
        classNames: ['semestra-item', o.status === 'cancelled' ? 'line-through opacity-60' : ''],
        borderColor: occurrenceColor(o),
        backgroundColor: `color-mix(in oklab, ${occurrenceColor(o)} 18%, var(--background))`,
        textColor: 'var(--foreground)',
        extendedProps: { occurrence: o },
      }
    }),
    ...term.breaks.map((b): EventInput => ({
      id: `break:${b.id}`,
      title: b.name,
      start: b.start_date,
      end: plusDays(b.end_date, 1),
      allDay: true,
      display: 'background',
    })),
  ]

  const onChange = (info: EventChangeArg) => {
    const o = info.event.extendedProps.occurrence as Occurrence | undefined
    const start = info.event.start
    if (!o || !start) return info.revert()
    const end = info.event.end ?? start
    if (isOneOff(o)) {
      updateEvent.mutate(
        {
          path: { event_id: o.ref.id },
          body: { start_at: wall(start), end_at: wall(end), all_day: info.event.allDay },
        },
        {
          onError: (error) => {
            info.revert()
            toastError(error)
          },
          onSettled: () => invalidateSchedule(queryClient),
        },
      )
      return
    }
    if (info.event.allDay || isoDay(start) !== isoDay(new Date(end.getTime() - 1))) {
      return info.revert()
    }
    setDrag({ occurrence: o, start, end, revert: info.revert })
  }

  const dragOnlyThis = async () => {
    if (!drag) return
    const { occurrence: o, start, end } = drag
    const request = {
      path: {
        meeting_id: o.meta?.meeting_id ?? o.ref.id,
        original_date: o.meta?.original_date ?? '',
      },
      body: {
        kind: 'moved' as const,
        new_date: isoDay(start),
        new_start_time: hhmm(start),
        new_end_time: hhmm(end),
        new_location: o.location ?? null,
        note: o.meta?.note ?? null,
      },
    }
    try {
      await upsertException.mutateAsync(request)
      setDrag(null)
    } catch (error) {
      drag.revert()
      setDrag(null)
      toastError(error)
    }
    await invalidateSchedule(queryClient)
  }
  const dragAll = async () => {
    if (!drag) return
    const { occurrence: o, start, end } = drag
    const request = {
      path: { meeting_id: o.meta?.meeting_id ?? o.ref.id },
      body: { weekday: isoWeekday(start), start_time: hhmm(start), end_time: hhmm(end) },
    }
    try {
      await updateMeeting.mutateAsync(request)
      setDrag(null)
    } catch (error) {
      drag.revert()
      setDrag(null)
      toastError(error)
    }
    await invalidateSchedule(queryClient)
  }

  const weekNumberLabel = (day: string) => {
    const week = weekOf(weeks, day)
    return week ? weekLabel(week.number, week.break_info?.name) : ''
  }
  const currentWeek = weekOf(weeks, rangeStart ? midWeek(rangeStart) : anchor)
  const detailsCourse = details ? courses.find((c) => c.id === details.course_id) : undefined
  const editingCourse = meetingEdit
    ? courses.find((c) => c.id === meetingEdit.course_id)
    : undefined
  const minWidth =
    settings.min_column_width > 0
      ? settings.min_column_width * (settings.show_weekends ? 7 : 5) + 56
      : undefined

  const filterPanel = (
    <FilterPanel
      filters={filters}
      onChange={setFilters}
      sources={sources}
      courses={courses}
      showCancelled={showCancelled}
    />
  )

  return (
    <div className="flex gap-6">
      <aside className="hidden w-52 shrink-0 lg:block">{filterPanel}</aside>
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Sheet>
            <SheetTrigger
              render={
                <Button
                  variant="outline"
                  size="icon-sm"
                  className="lg:hidden"
                  aria-label={m.schedule_filters()}
                />
              }
            >
              <ListFilter aria-hidden />
            </SheetTrigger>
            <SheetContent className="p-6">
              <SheetTitle className="mb-4">{m.schedule_filters()}</SheetTitle>
              {filterPanel}
            </SheetContent>
          </Sheet>
          {view !== 'timetable' ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => calendarRef.current?.getApi().gotoDate(today)}
              >
                {m.schedule_today()}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={m.schedule_previous()}
                onClick={() => calendarRef.current?.getApi().prev()}
              >
                <ChevronLeft aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={m.schedule_next()}
                onClick={() => calendarRef.current?.getApi().next()}
              >
                <ChevronRight aria-hidden />
              </Button>
              <h2 className="font-heading text-base font-medium">
                {title}
                {view !== 'month' && currentWeek ? (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {weekLabel(currentWeek.number, currentWeek.break_info?.name)}
                  </span>
                ) : null}
              </h2>
            </>
          ) : (
            <h2 className="font-heading text-base font-medium">{term.name}</h2>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <ToggleGroup
              aria-label={m.schedule_view()}
              size="sm"
              className={SEGMENTED}
              value={[view]}
              onValueChange={(value) => value[0] && changeView(value[0] as CalendarView)}
            >
              <ToggleGroupItem value="week" className={SEGMENT}>
                {m.settings_calendar_default_view_option_week()}
              </ToggleGroupItem>
              <ToggleGroupItem value="month" className={SEGMENT}>
                {m.settings_calendar_default_view_option_month()}
              </ToggleGroupItem>
              <ToggleGroupItem value="list" className={SEGMENT}>
                {m.settings_calendar_default_view_option_list()}
              </ToggleGroupItem>
              <ToggleGroupItem value="timetable" className={SEGMENT}>
                {m.settings_calendar_default_view_option_timetable()}
              </ToggleGroupItem>
            </ToggleGroup>
            <Button
              size="sm"
              onClick={() => {
                const slot = `${anchor}T09:00`
                setEventEdit({ slot: { start: slot, end: `${anchor}T10:00`, allDay: false } })
              }}
            >
              <Plus aria-hidden />
              {m.schedule_event_add()}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="secondary" size="sm">
                    <Download aria-hidden />
                    {m.schedule_share()}
                    <ChevronDown aria-hidden />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-72">
                {SHARE_KINDS.map((item) => (
                  <DropdownMenuItem key={item.kind} onClick={() => setShare(item.kind)}>
                    <item.icon aria-hidden />
                    <span className="min-w-0">
                      <span className="block">{item.label()}</span>
                      <span className="block text-xs text-muted-foreground">
                        {item.description()}
                      </span>
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {view === 'timetable' ? (
          <TimetableView
            termId={term.id}
            meetings={meetings}
            courses={courses}
            dayStart={settings.day_start}
            dayEnd={settings.day_end}
            showWeekends={settings.show_weekends}
            onEditMeeting={setMeetingEdit}
          />
        ) : (
          <div className="overflow-x-auto">
            <div className="semestra-calendar" style={{ minWidth }}>
              <FullCalendar
                // A new view (the toggle, or the stored one arriving) starts a fresh calendar.
                key={view}
                ref={calendarRef}
                plugins={PLUGINS}
                initialView={FC_VIEW[view]}
                initialDate={anchor}
                headerToolbar={false}
                height="auto"
                locales={LOCALES}
                locale={getLocale().startsWith('zh') ? 'zh-cn' : 'en'}
                firstDay={firstDayOfWeek() % 7}
                weekends={settings.show_weekends}
                slotMinTime={settings.day_start}
                slotMaxTime={settings.day_end === '24:00' ? '24:00:00' : settings.day_end}
                scrollTime={settings.day_start}
                nowIndicator
                now={now}
                weekNumbers
                weekNumberContent={(arg) => weekNumberLabel(midWeek(markerDay(arg.date)))}
                dayHeaderFormat={DAY_HEADER_FORMAT}
                views={VIEWS}
                slotDuration="01:00:00"
                snapDuration="00:15:00"
                slotLabelFormat={TIME_FORMATS[getFormatPreferences().timeFormat]}
                eventTimeFormat={TIME_FORMATS[getFormatPreferences().timeFormat]}
                allDayText={m.schedule_all_day()}
                noEventsText={m.schedule_no_events()}
                events={fcEvents}
                selectable
                selectMirror
                editable
                eventStartEditable
                select={(arg) => {
                  const end = arg.allDay ? plusDays(isoDay(arg.end), -1) : wall(arg.end)
                  setEventEdit({
                    slot: {
                      start: arg.allDay
                        ? `${isoDay(arg.start)}T00:00`
                        : wall(arg.start).slice(0, 16),
                      end: arg.allDay ? `${end}T00:00` : end.slice(0, 16),
                      allDay: arg.allDay,
                    },
                  })
                  arg.view.calendar.unselect()
                }}
                eventClick={(arg) => {
                  const o = arg.event.extendedProps.occurrence as Occurrence | undefined
                  if (o) showDetails(o)
                }}
                eventDrop={onChange}
                eventResize={onChange}
                eventContent={renderEventContent}
                datesSet={(arg) => {
                  setTitle(arg.view.title)
                  setRangeStart(isoDay(arg.start))
                  const type = arg.view.type
                  const nextView =
                    type === 'dayGridMonth' ? 'month' : type === 'listWeek' ? 'list' : 'week'
                  const date = isoDay(arg.view.calendar.getDate())
                  setShownDate(date)
                  saveNav({ view: nextView, date })
                  loadNeighbours(nextView, date)
                }}
              />
            </div>
          </div>
        )}
      </div>

      {details ? (
        <OccurrenceDetails
          occurrence={details}
          timezone={timezone}
          programId={programId}
          course={detailsCourse}
          open
          onOpenChange={(open) => !open && setDetails(null)}
          onMove={(o) => {
            setDetails(null)
            setMove({
              meetingId: o.meta?.meeting_id ?? o.ref.id,
              originalDate: o.meta?.original_date ?? '',
              date: toWall(o.start_at, timezone).slice(0, 10),
              start: toWall(o.start_at, timezone).slice(11, 16),
              end: toWall(o.end_at ?? o.start_at, timezone).slice(11, 16),
              location: o.location ?? '',
              note: o.meta?.note ?? '',
            })
          }}
          onEditMeeting={(o) => {
            if (!o.course_id) return
            // The details stay open until the meeting is here, then give way to its editor.
            meetingsOf(o)
              .then((list) => {
                const meeting = list.items.find((mt) => mt.id === o.meta?.meeting_id)
                setDetails(null)
                if (meeting) setMeetingEdit(meeting)
                else toast.error(m.error_common_not_found())
              })
              .catch(toastError)
          }}
          onEditEvent={(o) => {
            eventOf(o)
              .then((event) => {
                setDetails(null)
                setEventEdit({ event })
              })
              .catch(toastError)
          }}
        />
      ) : null}
      {move ? (
        <MoveDialog target={move} open onOpenChange={(open) => !open && setMove(null)} />
      ) : null}
      {meetingEdit && editingCourse ? (
        <MeetingDialog
          key={meetingEdit.id}
          programId={programId}
          courseId={editingCourse.id}
          termIds={editingCourse.term_ids}
          termId={term.id}
          meeting={meetingEdit}
          open
          onOpenChange={(open) => !open && setMeetingEdit(null)}
        />
      ) : null}
      {eventEdit ? (
        <EventDialog
          programId={programId}
          timezone={timezone}
          termId={term.id}
          event={eventEdit.event}
          slot={eventEdit.slot}
          open
          onOpenChange={(open) => !open && setEventEdit(null)}
        />
      ) : null}
      <DragChoiceDialog
        open={drag !== null}
        allowAll={drag?.occurrence.status !== 'moved'}
        pending={upsertException.isPending || updateMeeting.isPending}
        onOnlyThis={() => void dragOnlyThis()}
        onAll={() => void dragAll()}
        onCancel={() => {
          drag?.revert()
          setDrag(null)
        }}
      />
      {share ? (
        <ShareDialog
          kind={share}
          onKindChange={setShare}
          programId={programId}
          termId={term.id}
          termName={term.name}
          timezone={timezone}
          weeks={weeks}
          currentWeekStart={anchor}
          courses={courses}
          meetings={meetings}
          meetingsPending={termMeetings.isPending}
          sources={sources}
          defaultSources={wanted}
          hiddenCourses={filters.hiddenCourses}
          settings={settings}
          open
          onOpenChange={(open) => !open && setShare(null)}
        />
      ) : null}
    </div>
  )
}

const renderEventContent = (arg: EventContentArg) => <EventContent arg={arg} />

/** A week view's day header as in the timetable (WeekGrid): the weekday, the date under it. */
function WeekDayHeader({ arg }: { arg: DayHeaderContentArg }) {
  return (
    <span className={cn('block text-center', arg.isToday && 'text-primary')}>
      {arg.text}
      <span
        className={cn('block font-normal text-muted-foreground', arg.isToday && 'text-primary')}
      >
        {arg.date.getDate()}
      </span>
    </span>
  )
}

function EventContent({ arg }: { arg: EventContentArg }) {
  const o = arg.event.extendedProps.occurrence as Occurrence | undefined
  if (!o) return <span className="fc-event-title">{arg.event.title}</span>
  const conflict = (o.meta?.conflicts_with?.length ?? 0) > 0
  if (arg.view.type === 'timeGridWeek' && !arg.event.allDay) {
    // The timetable's block (WeekGrid): a straight-edged course-colored bar, title, place.
    return (
      <div className="flex h-full min-w-0 overflow-hidden leading-tight">
        <span
          aria-hidden
          className="w-1 shrink-0"
          style={{ backgroundColor: occurrenceColor(o) }}
        />
        <span className="min-w-0 flex-1 px-1 py-0.5">
          <span className="flex items-center gap-1 font-medium">
            {conflict ? (
              <TriangleAlert
                aria-label={m.schedule_conflict()}
                className="size-3 shrink-0 text-destructive"
              />
            ) : null}
            <span className="truncate">{o.title}</span>
          </span>
          {o.location ? (
            <span className="block truncate text-muted-foreground">{o.location}</span>
          ) : null}
        </span>
      </div>
    )
  }
  return (
    <div className="flex min-w-0 flex-col overflow-hidden px-1 leading-tight">
      <span className="flex items-center gap-1 truncate font-medium">
        {arg.view.type === 'dayGridMonth' || arg.view.type === 'listWeek' ? (
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: occurrenceColor(o) }}
          />
        ) : null}
        {conflict ? (
          <TriangleAlert
            aria-label={m.schedule_conflict()}
            className="size-3 shrink-0 text-destructive"
          />
        ) : null}
        {arg.timeText && arg.view.type === 'dayGridMonth' ? (
          <span className="text-muted-foreground">{arg.timeText}</span>
        ) : null}
        <span className="truncate">{o.title}</span>
      </span>
      {arg.view.type === 'timeGridWeek' && o.location ? (
        <span className="truncate text-muted-foreground">{o.location}</span>
      ) : null}
    </div>
  )
}
