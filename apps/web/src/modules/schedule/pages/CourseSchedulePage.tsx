import type { Course, EventType, Meeting, OneOffEvent } from '@semestra/api-client'
import {
  scheduleExceptionDeleteMutation,
  scheduleMeetingSetEnabledMutation,
} from '@semestra/api-client/react-query'
import {
  type CellContext,
  createColumnHelper,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, MoreHorizontal, Plus, RotateCcw } from 'lucide-react'
import { createContext, use, useState } from 'react'
import type { PageProps } from '@/app/extensions'
import { useExtensions } from '@/app/registry'
import { toastError } from '@/lib/errors'
import { formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useCourse, useTerms } from '@/modules/academics/queries'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { Switch } from '@/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/tabs'
import { EventDialog } from '../components/EventDialog'
import { MeetingDialog } from '../components/MeetingDialog'
import { meetingGridItems, useConflictingIds } from '../components/TimetableView'
import { WeekGrid, minutes, weekDays } from '../components/WeekGrid'
import { useProgramTimezone } from '../hooks'
import { dayLabel, timeRange, typeName } from '../labels'
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
  const settings = useCalendarSettings(termId)
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus aria-hidden />
          {m.schedule_meeting_add()}
        </Button>
        {importers.map((source) => (
          <Button
            key={source.id}
            size="sm"
            variant="outline"
            onClick={() =>
              void source
                .launch({ programId, courseId: course.id, termId })
                .then(() => invalidateSchedule(queryClient))
                .catch(toastError)
            }
          >
            <source.icon aria-hidden />
            {source.title()}
          </Button>
        ))}
      </div>

      {meetings.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarClock aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{m.schedule_meetings_empty()}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-5">
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
          </div>
          <section aria-label={m.schedule_week_preview()} className="space-y-2">
            <h3 className="text-sm font-medium">{m.schedule_week_preview()}</h3>
            <WeekGrid
              days={weekDays(settings.show_weekends || meetings.some((mt) => mt.weekday >= 6))}
              items={meetingGridItems(meetings, [course], conflicting, setEditing)}
              dayStart={minutes(settings.day_start)}
              dayEnd={minutes(settings.day_end)}
              hourHeight={28}
              compact
            />
          </section>
        </div>
      )}

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">{m.schedule_events()}</h3>
          <Button size="xs" variant="ghost" onClick={() => setEventEdit('new')}>
            <Plus aria-hidden />
            {m.schedule_event_add()}
          </Button>
        </div>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">{m.schedule_events_empty()}</p>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border text-sm">
            {events.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/40"
                  onClick={() => setEventEdit(e)}
                >
                  <span className="w-36 shrink-0 text-muted-foreground">
                    {dayLabel(wallDate(e.start_at, timezone))}
                  </span>
                  <span className="w-28 shrink-0 text-muted-foreground tabular-nums">
                    {timeRange(e, timezone)}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{e.title}</span>
                  {e.location ? (
                    <span className="truncate text-muted-foreground">{e.location}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {exceptions.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">{m.schedule_exceptions()}</h3>
          <ul className="divide-y divide-border rounded-2xl border border-border text-sm">
            {exceptions.map(({ meeting, exc }) => (
              <li key={exc.id} className="flex items-center gap-3 px-3 py-2">
                <span className="w-36 shrink-0">{dayLabel(exc.original_date)}</span>
                <span className="w-28 shrink-0 text-muted-foreground">
                  {meeting.type_code} {meeting.section_code}
                </span>
                <span className="min-w-0 flex-1 truncate">
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
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={restore.isPending}
                  onClick={() =>
                    restore.mutate({
                      path: { meeting_id: meeting.id, original_date: exc.original_date },
                    })
                  }
                >
                  <RotateCcw aria-hidden />
                  {m.schedule_restore()}
                </Button>
              </li>
            ))}
          </ul>
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

const features = tableFeatures({})
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
    <span className="font-medium">
      {row.original.section_code || '—'}
      {conflicting.has(row.original.id) ? (
        <span className="ml-1 text-xs text-destructive">{m.schedule_conflict()}</span>
      ) : null}
    </span>
  )
}

const TimeCell = ({ row }: CellProps) => (
  <span className="tabular-nums">
    {formatTime(row.original.start_time)} – {formatTime(row.original.end_time)}
  </span>
)

const ActionsHeader = () => <span className="sr-only">{m.schedule_actions()}</span>

function ActionsCell({ row }: CellProps) {
  const { meetings, onToggle, onEdit } = useMeetingGroup()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button size="icon-xs" variant="ghost" aria-label={m.schedule_actions()} />}
      >
        <MoreHorizontal aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => onEdit(row.original)}>
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
              {m.schedule_keep_only_this()}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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
    cell: ({ row }) => weekdayName(row.original.weekday),
  }),
  column.accessor((mt) => mt.start_time, {
    id: 'time',
    header: () => m.schedule_time(),
    cell: TimeCell,
  }),
  column.accessor((mt) => mt.start_week, {
    id: 'weeks',
    header: () => m.schedule_weeks(),
    cell: ({ row }) => weeksText(row.original),
  }),
  column.accessor((mt) => mt.location ?? '', {
    id: 'location',
    header: () => m.schedule_location(),
    cell: ({ row }) => row.original.location || '—',
  }),
  column.accessor((mt) => mt.instructor ?? '', {
    id: 'instructor',
    header: () => m.schedule_instructor(),
    cell: ({ row }) => row.original.instructor || '—',
  }),
  column.display({ id: 'actions', header: ActionsHeader, cell: ActionsCell }),
])

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
  const table = useTable({ features, columns, data: sorted, getRowId: (mt) => mt.id })
  return (
    <MeetingGroupContext value={state}>
      <section className="space-y-2">
        <h3 className="text-sm font-medium">
          {code}
          {type ? (
            <span className="font-normal text-muted-foreground"> · {typeName(type)}</span>
          ) : null}
        </h3>
        <div className="rounded-2xl border border-border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((group) => (
                <TableRow key={group.id}>
                  {group.headers.map((h) => (
                    <TableHead
                      key={h.id}
                      scope="col"
                      className={cn(h.column.id === 'enabled' && 'w-12')}
                    >
                      <table.FlexRender header={h} />
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={cn(!row.original.enabled && 'text-muted-foreground opacity-60')}
                >
                  {row.getAllCells().map((cell) => (
                    <TableCell key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </MeetingGroupContext>
  )
}
