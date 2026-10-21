import type {
  Course,
  EventType,
  Meeting,
  MeetingException,
  OneOffEvent,
} from '@semestra/api-client'
import {
  scheduleEventDeleteMutation,
  scheduleExceptionDeleteMutation,
  scheduleMeetingSetEnabledMutation,
} from '@semestra/api-client/react-query'
import { type CellContext, createColumnHelper } from '@tanstack/react-table'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CalendarClock,
  CalendarOff,
  CalendarPlus,
  ChevronDown,
  Import,
  ListFilter,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { createContext, use, useState } from 'react'
import type { PageProps } from '@/app/extensions'
import { ActionRow, RowMenu, SettingsTable, settingsTableFeatures } from '@/app/settings'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useExtensions } from '@/app/registry'
import { toastError } from '@/lib/errors'
import { formatTime } from '@/lib/format'
import { subjectColor } from '@/lib/subject-color'
import { cn } from '@/lib/utils'
import { useCourse, useTerms } from '@/modules/academics/queries'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/ui/empty'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { Switch } from '@/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/tabs'
import { EventDialog } from '../components/EventDialog'
import { MeetingDialog } from '../components/MeetingDialog'
import { meetingGridItems, useConflictingIds } from '../components/TimetableView'
import { WeekGrid, minutes, weekDays } from '../components/WeekGrid'
import { useProgramTimezone } from '../hooks'
import { dayLabel, sectionLabel, timeRange, typeName } from '../labels'
import {
  invalidateSchedule,
  useCalendarSettings,
  useEvents,
  useEventTypes,
  useMeetings,
} from '../queries'
import { wallDate, weekdayName } from '../time'
import { MEETING_IMPORT_SOURCES, type MeetingImportSource } from '../types'

/** A course's schedule (M04 §5.3): meetings per term and type, one-off events, exceptions. */
export default function CourseSchedulePage({ scope }: PageProps) {
  const courseId = scope.kind === 'course' ? scope.courseId : ''
  const course = useCourse(courseId).data
  const terms = useTerms(scope.programId).data?.items ?? []
  const timezone = useProgramTimezone(scope.programId)
  const [tab, setTab] = useState<string | null>(null)
  if (!course || !timezone) return null
  const courseTerms = course.term_ids
    .map((id) => terms.find((t) => t.id === id))
    .filter((t) => t !== undefined)
  const fallback = courseTerms.find((t) => t.is_current)?.id ?? course.term_ids[0] ?? ''
  const active = tab && course.term_ids.includes(tab) ? tab : fallback
  if (courseTerms.length <= 1) {
    return (
      <TermSchedule
        programId={scope.programId}
        course={course}
        termId={active}
        timezone={timezone}
      />
    )
  }
  return (
    <Tabs value={active} onValueChange={(value) => setTab(String(value))}>
      <TabsList>
        {courseTerms.map((t) => (
          <TabsTrigger key={t.id} value={t.id}>
            {t.name}
          </TabsTrigger>
        ))}
      </TabsList>
      {courseTerms.map((t) => (
        <TabsContent key={t.id} value={t.id} className="pt-2">
          <TermSchedule
            programId={scope.programId}
            course={course}
            termId={t.id}
            timezone={timezone}
          />
        </TabsContent>
      ))}
    </Tabs>
  )
}

function TermSchedule({
  programId,
  course,
  termId,
  timezone,
}: {
  programId: string
  course: Course
  termId: string
  timezone: string
}) {
  const queryClient = useQueryClient()
  const meetings = useMeetings(course.id, termId).data?.items ?? []
  const types = useEventTypes(programId).data?.items ?? []
  const events = (useEvents(programId, { course_id: course.id }).data?.items ?? []).filter(
    (e) => !e.term_id || e.term_id === termId,
  )
  const conflicting = useConflictingIds(termId)
  const importers = useExtensions<MeetingImportSource>(MEETING_IMPORT_SOURCES)
  const [editing, setEditing] = useState<Meeting | 'new' | null>(null)
  const [eventEdit, setEventEdit] = useState<OneOffEvent | 'new' | null>(null)

  const setEnabled = useMutation({
    ...scheduleMeetingSetEnabledMutation(),
    onError: toastError,
    onSettled: () => invalidateSchedule(queryClient),
  })
  const restore = useMutation({
    ...scheduleExceptionDeleteMutation(),
    onError: toastError,
    onSettled: () => invalidateSchedule(queryClient),
  })
  const toggle = (ids: string[], enabled: boolean) =>
    setEnabled.mutate({ path: { course_id: course.id }, body: { meeting_ids: ids, enabled } })

  const typeCodes = [
    ...types.map((t) => t.code).filter((code) => meetings.some((mt) => mt.type_code === code)),
    ...new Set(
      meetings.map((mt) => mt.type_code).filter((code) => !types.some((t) => t.code === code)),
    ),
  ]
  const exceptions = meetings
    .flatMap((mt) => mt.exceptions.map((exc) => ({ meeting: mt, exc })))
    .toSorted((a, b) => a.exc.original_date.localeCompare(b.exc.original_date))

  const enabled = meetings.filter((mt) => mt.enabled)
  // The whole week and day of the Program's calendar settings; the grid widens for classes
  // outside them.
  const calendar = useCalendarSettings(termId)
  const gridItems = meetingGridItems(enabled, [course], conflicting, setEditing, {
    bySection: true,
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="sm" />}>
            <Plus aria-hidden />
            {m.schedule_add()}
            <ChevronDown aria-hidden data-icon="inline-end" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => setEditing('new')}>
              <CalendarClock aria-hidden />
              {m.schedule_add_meeting()}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setEventEdit('new')}>
              <CalendarPlus aria-hidden />
              {m.schedule_add_event()}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {importers.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
              <Import aria-hidden />
              {m.schedule_import()}
              <ChevronDown aria-hidden data-icon="inline-end" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {importers.map((source) => (
                <DropdownMenuItem
                  key={source.id}
                  onClick={() =>
                    void source
                      .launch({ programId, courseId: course.id, termId })
                      .then(() => invalidateSchedule(queryClient))
                      .catch(toastError)
                  }
                >
                  <source.icon aria-hidden />
                  {source.title()}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {meetings.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarClock aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{m.schedule_meetings_empty()}</EmptyTitle>
            <EmptyDescription>{m.schedule_meetings_empty_description()}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus aria-hidden />
              {m.schedule_meeting_add()}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <section aria-label={m.schedule_week_view()} className="space-y-2">
            <h3 className="text-sm font-medium">{m.schedule_week_view()}</h3>
            {enabled.length === 0 ? (
              <Empty className="rounded-2xl border border-solid border-border p-6">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <CalendarOff aria-hidden />
                  </EmptyMedia>
                  <EmptyTitle>{m.schedule_meetings_all_disabled()}</EmptyTitle>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="rounded-2xl border border-border p-3 pt-2">
                <WeekGrid
                  days={weekDays(calendar.show_weekends || enabled.some((mt) => mt.weekday >= 6))}
                  items={gridItems}
                  dayStart={minutes(calendar.day_start)}
                  dayEnd={minutes(calendar.day_end)}
                  hourHeight={44}
                />
              </div>
            )}
          </section>
          {typeCodes.map((code) => (
            <MeetingGroup
              key={code}
              type={types.find((t) => t.code === code)}
              code={code}
              meetings={meetings.filter((mt) => mt.type_code === code)}
              conflicting={conflicting}
              busy={setEnabled.isPending}
              onToggle={toggle}
              onEdit={setEditing}
            />
          ))}
        </>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-medium">{m.schedule_events()}</h3>
        {events.length === 0 ? (
          <Empty className="rounded-2xl border border-border border-solid p-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CalendarPlus aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{m.schedule_events_empty_title()}</EmptyTitle>
            </EmptyHeader>
            <EmptyContent>
              <Button size="sm" variant="link" onClick={() => setEventEdit('new')}>
                {m.schedule_event_add()}
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <EventsTable
            events={events}
            types={types}
            timezone={timezone}
            onEdit={setEventEdit}
            onAdd={() => setEventEdit('new')}
          />
        )}
      </section>

      {exceptions.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">{m.schedule_exceptions()}</h3>
          <ExceptionsTable
            exceptions={exceptions}
            busy={restore.isPending}
            onRestore={(meeting, exc) =>
              restore.mutate({ path: { meeting_id: meeting.id, original_date: exc.original_date } })
            }
          />
        </section>
      ) : null}

      {editing ? (
        <MeetingDialog
          key={editing === 'new' ? 'new' : editing.id}
          programId={programId}
          courseId={course.id}
          termIds={course.term_ids}
          termId={termId}
          meeting={editing === 'new' ? undefined : editing}
          open
          onOpenChange={(open) => !open && setEditing(null)}
        />
      ) : null}
      {eventEdit ? (
        <EventDialog
          programId={programId}
          timezone={timezone}
          termId={termId}
          courseId={course.id}
          event={eventEdit === 'new' ? undefined : eventEdit}
          open
          onOpenChange={(open) => !open && setEventEdit(null)}
        />
      ) : null}
    </div>
  )
}

const features = settingsTableFeatures
const column = createColumnHelper<typeof features, Meeting>()

function weeksText(mt: Meeting): string {
  const range = mt.end_week
    ? m.schedule_weeks_range({ start: mt.start_week, end: mt.end_week })
    : m.schedule_weeks_from({ start: mt.start_week })
  return mt.recurrence === 'biweekly'
    ? `${m.schedule_recurrence_biweekly()} (${m.schedule_week_number({ number: mt.anchor_week })}) · ${range}`
    : range
}

type MeetingGroupState = {
  code: string
  meetings: Meeting[]
  conflicting: ReadonlySet<string>
  busy: boolean
  onToggle: (ids: string[], enabled: boolean) => void
  onEdit: (meeting: Meeting) => void
}

/** What the cells of one `MeetingGroup` table need; the columns live outside the component. */
const MeetingGroupContext = createContext<MeetingGroupState | null>(null)

function useMeetingGroup(): MeetingGroupState {
  const group = use(MeetingGroupContext)
  if (!group) throw new Error('Meeting cells render inside a MeetingGroup')
  return group
}

type CellProps = CellContext<typeof features, Meeting>

const EnabledHeader = () => <span className="sr-only">{m.schedule_enabled()}</span>

/** A disabled meeting's text is dimmed; its switch and menu stay readable. */
const dim = (mt: Meeting) => cn(!mt.enabled && 'text-muted-foreground opacity-60')

function EnabledCell({ row }: CellProps) {
  const { code, busy, onToggle } = useMeetingGroup()
  return (
    <Switch
      aria-label={m.schedule_enable_section({ name: row.original.section_code || code })}
      checked={row.original.enabled}
      disabled={busy}
      onCheckedChange={(on) => onToggle([row.original.id], on)}
    />
  )
}

function SectionCell({ row }: CellProps) {
  const { conflicting } = useMeetingGroup()
  return (
    <span className={cn('font-medium', dim(row.original))}>
      {row.original.section_code || '—'}
      {conflicting.has(row.original.id) ? (
        <span className="ml-1 text-xs text-destructive">{m.schedule_conflict()}</span>
      ) : null}
    </span>
  )
}

const TimeCell = ({ row }: CellProps) => (
  <span className={cn('tabular-nums', dim(row.original))}>
    {formatTime(row.original.start_time)} – {formatTime(row.original.end_time)}
  </span>
)

const ActionsHeader = () => <span className="sr-only">{m.schedule_actions()}</span>

function ActionsCell({ row }: CellProps) {
  const { meetings, onToggle, onEdit } = useMeetingGroup()
  return (
    <RowMenu label={m.schedule_actions()}>
      <DropdownMenuItem onClick={() => onEdit(row.original)}>
        <Pencil aria-hidden />
        {m.schedule_meeting_edit()}
      </DropdownMenuItem>
      {meetings.length > 1 ? (
        <DropdownMenuItem
          onClick={() => {
            onToggle([row.original.id], true)
            onToggle(
              meetings.filter((mt) => mt.id !== row.original.id).map((mt) => mt.id),
              false,
            )
          }}
        >
          <ListFilter aria-hidden />
          {m.schedule_keep_only_this()}
        </DropdownMenuItem>
      ) : null}
    </RowMenu>
  )
}

const columns = column.columns([
  column.display({ id: 'enabled', header: EnabledHeader, cell: EnabledCell }),
  column.accessor((mt) => mt.section_code, {
    id: 'section',
    header: () => m.schedule_section_code(),
    cell: SectionCell,
  }),
  column.accessor((mt) => mt.weekday, {
    id: 'weekday',
    header: () => m.schedule_weekday(),
    cell: ({ row }) => (
      <span className={dim(row.original)}>{weekdayName(row.original.weekday)}</span>
    ),
  }),
  column.accessor((mt) => mt.start_time, {
    id: 'time',
    header: () => m.schedule_time(),
    cell: TimeCell,
  }),
  column.accessor((mt) => mt.start_week, {
    id: 'weeks',
    header: () => m.schedule_weeks(),
    cell: ({ row }) => <span className={dim(row.original)}>{weeksText(row.original)}</span>,
  }),
  column.accessor((mt) => mt.location ?? '', {
    id: 'location',
    header: () => m.schedule_location(),
    cell: ({ row }) => (
      <span className={cn('block truncate', dim(row.original))}>
        {row.original.location || '—'}
      </span>
    ),
  }),
  column.accessor((mt) => mt.instructor ?? '', {
    id: 'instructor',
    header: () => m.schedule_instructor(),
    cell: ({ row }) => (
      <span className={cn('block truncate', dim(row.original))}>
        {row.original.instructor || '—'}
      </span>
    ),
  }),
  column.display({ id: 'actions', header: ActionsHeader, cell: ActionsCell }),
])

const MEETING_COLUMN_CLASS: Record<string, string> = {
  enabled: 'w-12',
  location: 'w-full max-w-0',
  instructor: 'max-w-40',
  actions: 'w-10',
}

/** The meetings of one type (e.g. all TUT sections) with enable switches. */
function MeetingGroup({
  type,
  code,
  meetings,
  conflicting,
  busy,
  onToggle,
  onEdit,
}: {
  type?: EventType
  code: string
  meetings: Meeting[]
  conflicting: ReadonlySet<string>
  busy: boolean
  onToggle: (ids: string[], enabled: boolean) => void
  onEdit: (meeting: Meeting) => void
}) {
  const sorted = meetings.toSorted(
    (a, b) =>
      a.section_code.localeCompare(b.section_code, undefined, { numeric: true }) ||
      a.weekday - b.weekday ||
      a.start_time.localeCompare(b.start_time),
  )
  const state = { code, meetings, conflicting, busy, onToggle, onEdit }
  return (
    <MeetingGroupContext value={state}>
      <section className="space-y-2">
        <h3 className="text-sm font-medium">
          {code}
          {type ? (
            <span className="font-normal text-muted-foreground"> · {typeName(type)}</span>
          ) : null}
        </h3>
        <SettingsTable
          label={type ? `${code} · ${typeName(type)}` : code}
          data={sorted}
          columns={columns}
          getRowId={(mt) => mt.id}
          columnClassName={MEETING_COLUMN_CLASS}
        />
      </section>
    </MeetingGroupContext>
  )
}

const eventColumn = createColumnHelper<typeof features, OneOffEvent>()

/**
 * Cells live at module level and read the page's state from context (see CoursesTable): a cell
 * defined inside the component would be a new component on every render and remount.
 */
type EventsState = {
  types: EventType[]
  timezone: string
  onEdit: (event: OneOffEvent) => void
  onDelete: (event: OneOffEvent) => void
}
const EventsContext = createContext<EventsState | null>(null)

function useEventsState(): EventsState {
  const state = use(EventsContext)
  if (!state) throw new Error('EventsTable cells must render inside EventsTable')
  return state
}

type EventCell = CellContext<typeof features, OneOffEvent>

/** Type color dot and title, with the type and location below; the title opens the editor. */
function EventTitleCell({ row }: EventCell) {
  const { types, onEdit } = useEventsState()
  const event = row.original
  const type = types.find((t) => t.code === event.type_code)
  const typeLabel = type ? typeName(type) : event.type_code
  const detail = [typeLabel, event.location].filter(Boolean).join(' · ')
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full"
        style={{
          backgroundColor: type?.color ? subjectColor(type.color) : 'var(--muted-foreground)',
        }}
      />
      <span className="min-w-0 flex-1">
        <button
          type="button"
          className="block max-w-full cursor-pointer truncate text-left font-medium hover:underline"
          onClick={() => onEdit(event)}
        >
          {event.title}
        </button>
        {detail ? (
          <span className="block truncate text-xs text-muted-foreground">{detail}</span>
        ) : null}
      </span>
    </div>
  )
}

function EventWhenCell({ row }: EventCell) {
  const { timezone } = useEventsState()
  return (
    <span className="block">
      <span className="block">{dayLabel(wallDate(row.original.start_at, timezone))}</span>
      <span className="block text-xs text-muted-foreground tabular-nums">
        {timeRange(row.original, timezone)}
      </span>
    </span>
  )
}

function EventActionsCell({ row }: EventCell) {
  const { onEdit, onDelete } = useEventsState()
  return (
    <RowMenu label={`${m.schedule_actions()}: ${row.original.title}`}>
      <DropdownMenuItem onClick={() => onEdit(row.original)}>
        <Pencil aria-hidden />
        {m.schedule_event_edit()}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onClick={() => onDelete(row.original)}>
        <Trash2 aria-hidden />
        {m.schedule_event_delete()}
      </DropdownMenuItem>
    </RowMenu>
  )
}

const eventColumns = eventColumn.columns([
  eventColumn.accessor((e) => e.title, {
    id: 'title',
    header: () => m.schedule_event_title(),
    cell: EventTitleCell,
  }),
  eventColumn.accessor((e) => e.start_at, {
    id: 'when',
    header: () => m.schedule_date(),
    cell: EventWhenCell,
  }),
  eventColumn.display({ id: 'actions', header: ActionsHeader, cell: EventActionsCell }),
])

const EVENT_COLUMN_CLASS: Record<string, string> = {
  title: 'w-full max-w-0',
  actions: 'w-10',
}

/** The course's one-off events (exams, extra sessions) in the shared settings-table style. */
function EventsTable({
  events,
  types,
  timezone,
  onEdit,
  onAdd,
}: {
  events: OneOffEvent[]
  types: EventType[]
  timezone: string
  onEdit: (event: OneOffEvent) => void
  onAdd: () => void
}) {
  const queryClient = useQueryClient()
  const [deleting, setDeleting] = useState<OneOffEvent | null>(null)
  const remove = useMutation({
    ...scheduleEventDeleteMutation(),
    onError: toastError,
    onSuccess: () => setDeleting(null),
    onSettled: () => invalidateSchedule(queryClient),
  })
  const sorted = events.toSorted((a, b) => a.start_at.localeCompare(b.start_at))
  return (
    <EventsContext value={{ types, timezone, onEdit, onDelete: setDeleting }}>
      <SettingsTable
        label={m.schedule_events()}
        data={sorted}
        columns={eventColumns}
        getRowId={(e) => e.id}
        columnClassName={EVENT_COLUMN_CLASS}
        footer={
          <ActionRow icon={Plus} onClick={onAdd}>
            {m.schedule_event_add()}
          </ActionRow>
        }
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={m.schedule_event_delete_title()}
        description={m.schedule_event_delete_description()}
        confirmLabel={m.schedule_event_delete()}
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate({ path: { event_id: deleting.id } })}
      />
    </EventsContext>
  )
}

type ExceptionRow = { meeting: Meeting; exc: MeetingException }
const exceptionColumn = createColumnHelper<typeof features, ExceptionRow>()

type ExceptionsState = {
  busy: boolean
  onRestore: (meeting: Meeting, exc: MeetingException) => void
}
const ExceptionsContext = createContext<ExceptionsState | null>(null)

type ExceptionCell = CellContext<typeof features, ExceptionRow>

function ExceptionDateCell({ row }: ExceptionCell) {
  return dayLabel(row.original.exc.original_date)
}

function ExceptionSectionCell({ row }: ExceptionCell) {
  return sectionLabel(row.original.meeting)
}

function ExceptionChangeCell({ row }: ExceptionCell) {
  const { exc } = row.original
  return (
    <span className="whitespace-normal">
      {exc.kind === 'cancelled'
        ? m.schedule_status_cancelled()
        : m.schedule_moved_to({
            when: [
              exc.new_date ? dayLabel(exc.new_date) : null,
              exc.new_start_time ? formatTime(exc.new_start_time) : null,
              exc.new_location,
            ]
              .filter(Boolean)
              .join(' · '),
          })}
      {exc.note ? <span className="text-muted-foreground"> · {exc.note}</span> : null}
    </span>
  )
}

function ExceptionRestoreCell({ row }: ExceptionCell) {
  const state = use(ExceptionsContext)
  if (!state) throw new Error('ExceptionsTable cells must render inside ExceptionsTable')
  return (
    <div className="flex justify-end">
      <Button
        size="xs"
        variant="ghost"
        disabled={state.busy}
        onClick={() => state.onRestore(row.original.meeting, row.original.exc)}
      >
        <RotateCcw aria-hidden />
        {m.schedule_restore()}
      </Button>
    </div>
  )
}

const exceptionColumns = exceptionColumn.columns([
  exceptionColumn.accessor((r) => r.exc.original_date, {
    id: 'date',
    header: () => m.schedule_date(),
    cell: ExceptionDateCell,
  }),
  exceptionColumn.accessor((r) => r.meeting.section_code, {
    id: 'section',
    header: () => m.schedule_section_code(),
    cell: ExceptionSectionCell,
  }),
  exceptionColumn.display({
    id: 'change',
    header: () => m.schedule_exception_change(),
    cell: ExceptionChangeCell,
  }),
  exceptionColumn.display({ id: 'actions', header: ActionsHeader, cell: ExceptionRestoreCell }),
])

const EXCEPTION_COLUMN_CLASS: Record<string, string> = {
  change: 'w-full max-w-0',
}

/** Cancelled and moved classes, each with a button that puts the class back. */
function ExceptionsTable({
  exceptions,
  busy,
  onRestore,
}: {
  exceptions: ExceptionRow[]
  busy: boolean
  onRestore: (meeting: Meeting, exc: MeetingException) => void
}) {
  return (
    <ExceptionsContext value={{ busy, onRestore }}>
      <SettingsTable
        label={m.schedule_exceptions()}
        data={exceptions}
        columns={exceptionColumns}
        getRowId={(r) => r.exc.id}
        columnClassName={EXCEPTION_COLUMN_CLASS}
      />
    </ExceptionsContext>
  )
}
