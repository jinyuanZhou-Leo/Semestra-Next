import type { EventType, Meeting } from '@semestra/api-client'
import { type CellContext, createColumnHelper } from '@tanstack/react-table'
import { ListFilter, Pencil, Plus, Trash2 } from 'lucide-react'
import { createContext, use } from 'react'
import { ActionRow, RowMenu, SettingsTable, settingsTableFeatures } from '@/app/settings'
import { formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/ui/dropdown-menu'
import { Switch } from '@/ui/switch'
import { typeName } from '../labels'
import { weekdayName } from '../time'
import { ActionsHeader } from './ActionsHeader'

function weeksText(mt: Meeting): string {
  const range = mt.end_week
    ? m.schedule_weeks_range({ start: mt.start_week, end: mt.end_week })
    : m.schedule_weeks_from({ start: mt.start_week })
  return mt.recurrence === 'biweekly'
    ? `${m.schedule_recurrence_biweekly()} (${m.schedule_week_number({ number: mt.anchor_week })}) · ${range}`
    : range
}

/** A section (e.g. LEC0101) with the meetings it has, in order. */
type Section = { key: string; code: string; meetings: Meeting[] }

/**
 * A table row: one meeting of a section, or the section's closing "Add time" row. The section's
 * own cell spans all its rows.
 */
type Row =
  | { kind: 'meeting'; id: string; section: Section; meeting: Meeting; first: boolean }
  | { kind: 'add'; id: string; section: Section; first: false }

const features = settingsTableFeatures
const column = createColumnHelper<typeof features, Row>()

type MeetingGroupState = {
  code: string
  meetings: Meeting[]
  conflicting: ReadonlySet<string>
  busy: boolean
  onToggle: (ids: string[], enabled: boolean) => void
  onKeepOnly: (keep: string[], others: string[]) => void
  onEdit: (meeting: Meeting) => void
  /** Adds a meeting to the section with this code. */
  onAddTime: (section: Section) => void
  onEditSection: (section: Section) => void
  onDeleteSection: (section: Section) => void
}

/** What the cells of one `MeetingGroup` table need; the columns live outside the component. */
const MeetingGroupContext = createContext<MeetingGroupState | null>(null)

function useMeetingGroup(): MeetingGroupState {
  const group = use(MeetingGroupContext)
  if (!group) throw new Error('Meeting cells render inside a MeetingGroup')
  return group
}

type CellProps = CellContext<typeof features, Row>

/** A switched-off meeting's text is dimmed; its switch and menu stay readable. */
const dim = (on: boolean) => cn(!on && 'text-muted-foreground opacity-60')

/** The section: its switch (all its meetings at once), code, instructor and menu. */
function SectionCell({ row }: CellProps) {
  const { code, meetings, conflicting, busy, onToggle, onKeepOnly, onAddTime } = useMeetingGroup()
  const { onEditSection, onDeleteSection } = useMeetingGroup()
  const { section } = row.original
  const own = section.meetings
  const on = own.some((mt) => mt.enabled)
  const others = meetings.filter((mt) => !own.includes(mt))
  const instructor = own.find((mt) => mt.instructor)?.instructor
  const name = section.code || code
  return (
    <div className="flex items-start gap-3 self-start">
      <Switch
        className="mt-0.5"
        aria-label={m.schedule_enable_section({ name })}
        checked={on}
        disabled={busy}
        onCheckedChange={(next) =>
          onToggle(
            own.map((mt) => mt.id),
            next,
          )
        }
      />
      <div className={cn('min-w-0 flex-1', dim(on))}>
        <div className="flex items-center gap-2 font-medium">
          <span className="truncate">{section.code || '—'}</span>
          {own.some((mt) => conflicting.has(mt.id)) ? (
            <Badge variant="destructive">{m.schedule_conflict()}</Badge>
          ) : null}
        </div>
        {instructor ? (
          <div className="truncate text-xs text-muted-foreground">{instructor}</div>
        ) : null}
      </div>
      <RowMenu label={m.schedule_section_actions({ section: name })}>
        <DropdownMenuItem onClick={() => onEditSection(section)}>
          <Pencil aria-hidden />
          {m.schedule_section_edit()}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAddTime(section)}>
          <Plus aria-hidden />
          {m.schedule_section_add_time()}
        </DropdownMenuItem>
        {others.length > 0 ? (
          <DropdownMenuItem
            onClick={() =>
              onKeepOnly(
                own.map((mt) => mt.id),
                others.map((mt) => mt.id),
              )
            }
          >
            <ListFilter aria-hidden />
            {m.schedule_keep_only_this()}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => onDeleteSection(section)}>
          <Trash2 aria-hidden />
          {m.schedule_section_delete()}
        </DropdownMenuItem>
      </RowMenu>
    </div>
  )
}

/** One meeting's switch; the add row puts its button here, across the meeting columns. */
function MeetingSwitchCell({ row }: CellProps) {
  const { busy, onToggle, onAddTime } = useMeetingGroup()
  const r = row.original
  if (r.kind === 'add') {
    return (
      <Button size="xs" variant="ghost" onClick={() => onAddTime(r.section)}>
        <Plus aria-hidden />
        {m.schedule_section_add_time()}
      </Button>
    )
  }
  return (
    <Switch
      size="sm"
      aria-label={m.schedule_enable_meeting({
        day: weekdayName(r.meeting.weekday),
        time: formatTime(r.meeting.start_time),
      })}
      checked={r.meeting.enabled}
      disabled={busy}
      onCheckedChange={(on) => onToggle([r.meeting.id], on)}
    />
  )
}

/** A meeting's text cell, dimmed when it (or its whole section) is off. */
function text(render: (mt: Meeting) => string, className?: string) {
  return function TextCell({ row }: CellProps) {
    const r = row.original
    if (r.kind !== 'meeting') return null
    return (
      <span className={cn('block truncate', className, dim(r.meeting.enabled))}>
        {render(r.meeting)}
      </span>
    )
  }
}

const WeekdayCell = text((mt) => weekdayName(mt.weekday))
const TimeCell = text(
  (mt) => `${formatTime(mt.start_time)} – ${formatTime(mt.end_time)}`,
  'tabular-nums',
)
const WeeksCell = text(weeksText)
const LocationCell = text((mt) => mt.location || '—')

function ActionsCell({ row }: CellProps) {
  const { code, onEdit } = useMeetingGroup()
  const r = row.original
  if (r.kind !== 'meeting') return null
  return (
    <RowMenu
      label={m.schedule_meeting_actions({
        section: r.section.code || code,
        day: weekdayName(r.meeting.weekday),
      })}
    >
      <DropdownMenuItem onClick={() => onEdit(r.meeting)}>
        <Pencil aria-hidden />
        {m.schedule_meeting_edit()}
      </DropdownMenuItem>
    </RowMenu>
  )
}

const columns = column.columns([
  column.display({
    id: 'section',
    header: () => m.schedule_section_code(),
    cell: SectionCell,
  }),
  column.display({
    id: 'on',
    header: () => <span className="sr-only">{m.schedule_enabled()}</span>,
    cell: MeetingSwitchCell,
  }),
  column.display({ id: 'weekday', header: () => m.schedule_weekday(), cell: WeekdayCell }),
  column.display({ id: 'time', header: () => m.schedule_time(), cell: TimeCell }),
  column.display({ id: 'weeks', header: () => m.schedule_weeks(), cell: WeeksCell }),
  column.display({ id: 'location', header: () => m.schedule_location(), cell: LocationCell }),
  column.display({ id: 'actions', header: ActionsHeader, cell: ActionsCell }),
])

// Fixed widths so the tables of each type line up under one another.
const MEETING_COLUMN_CLASS: Record<string, string> = {
  section: 'w-56 min-w-56 max-w-56 border-r [td&]:pt-4 [td&]:align-top',
  on: 'w-14 pl-4',
  weekday: 'w-24 min-w-24',
  time: 'w-44 min-w-44',
  weeks: 'w-72 min-w-72',
  location: 'w-full max-w-0',
  actions: 'w-10',
}

/** The section cell spans its meetings and add row; the add row's button spans the rest. */
function cellSpan(columnId: string, row: Row) {
  if (columnId === 'section') {
    return row.first ? { rowSpan: row.section.meetings.length + 1 } : null
  }
  if (row.kind === 'add') return columnId === 'on' ? { colSpan: 6 } : null
  return undefined
}

/** The meetings of one type (e.g. all TUT sections), grouped by section. */
export function MeetingGroup({
  type,
  onAdd,
  ...state
}: MeetingGroupState & { type?: EventType; onAdd: () => void }) {
  const { code, meetings } = state
  const sorted = meetings.toSorted(
    (a, b) =>
      a.section_code.localeCompare(b.section_code, undefined, { numeric: true }) ||
      a.weekday - b.weekday ||
      a.start_time.localeCompare(b.start_time),
  )
  // A meeting without a section code is a section of its own.
  const sections: Section[] = []
  for (const mt of sorted) {
    const last = sections.at(-1)
    if (mt.section_code && last?.code === mt.section_code) last.meetings.push(mt)
    else sections.push({ key: mt.id, code: mt.section_code, meetings: [mt] })
  }
  const rows: Row[] = sections.flatMap((section) => [
    ...section.meetings.map((meeting, i): Row => ({
      kind: 'meeting',
      id: meeting.id,
      section,
      meeting,
      first: i === 0,
    })),
    { kind: 'add', id: `${section.key}:add`, section, first: false },
  ])
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
          data={rows}
          columns={columns}
          getRowId={(r) => r.id}
          columnClassName={MEETING_COLUMN_CLASS}
          cellSpan={cellSpan}
          footer={
            <ActionRow icon={Plus} onClick={onAdd}>
              {m.schedule_section_add({ type: code })}
            </ActionRow>
          }
        />
      </section>
    </MeetingGroupContext>
  )
}

export type { Section as MeetingSection }
