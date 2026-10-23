import type { EventType, Meeting } from '@semestra/api-client'
import { type CellContext, createColumnHelper } from '@tanstack/react-table'
import { ListFilter, Pencil } from 'lucide-react'
import { createContext, use } from 'react'
import { RowMenu, SettingsTable, settingsTableFeatures } from '@/app/settings'
import { formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { DropdownMenuItem } from '@/ui/dropdown-menu'
import { Switch } from '@/ui/switch'
import { typeName } from '../labels'
import { weekdayName } from '../time'
import { ActionsHeader } from './ActionsHeader'

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
  onKeepOnly: (keep: string[], others: string[]) => void
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

function ActionsCell({ row }: CellProps) {
  const { code, meetings, onKeepOnly, onEdit } = useMeetingGroup()
  // A section can meet on several days: keeping it keeps all of them.
  const section = row.original.section_code
  const own = meetings.filter((mt) => mt.section_code === section)
  const others = meetings.filter((mt) => mt.section_code !== section)
  return (
    <RowMenu
      label={m.schedule_meeting_actions({
        section: row.original.section_code || code,
        day: weekdayName(row.original.weekday),
      })}
    >
      <DropdownMenuItem onClick={() => onEdit(row.original)}>
        <Pencil aria-hidden />
        {m.schedule_meeting_edit()}
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
export function MeetingGroup({ type, ...state }: MeetingGroupState & { type?: EventType }) {
  const { code, meetings } = state
  const sorted = meetings.toSorted(
    (a, b) =>
      a.section_code.localeCompare(b.section_code, undefined, { numeric: true }) ||
      a.weekday - b.weekday ||
      a.start_time.localeCompare(b.start_time),
  )
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
