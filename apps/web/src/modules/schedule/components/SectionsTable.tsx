import type { EventType, Meeting, Section } from '@semestra/api-client'
import { type CellContext, createColumnHelper } from '@tanstack/react-table'
import { ChevronRight, ListFilter, Pencil, Trash2 } from 'lucide-react'
import { createContext, type ReactNode, use, useState } from 'react'
import { RowMenu, SettingsTable, settingsTableFeatures } from '@/app/settings'
import { formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/ui/dropdown-menu'
import { Switch } from '@/ui/switch'
import { sectionLabel, typeName } from '../labels'
import { weeksText } from '../sections'
import { weekdayName } from '../time'
import { ActionsHeader } from './ActionsHeader'

const timeRange = (mt: Meeting) => `${formatTime(mt.start_time)} – ${formatTime(mt.end_time)}`

/** "Mon, Wed 10:00 – 11:00": the section's times, days sharing a time put together. */
function timesSummary(meetings: readonly Meeting[]): string {
  const byTime = new Map<string, Meeting[]>()
  for (const mt of meetings) {
    const key = timeRange(mt)
    byTime.set(key, [...(byTime.get(key) ?? []), mt])
  }
  return [...byTime]
    .map(
      ([range, same]) =>
        `${same.map((mt) => weekdayName(mt.weekday, 'short')).join(m.schedule_list_separator())} ${range}`,
    )
    .join(' · ')
}

/** Sections in the order of the Program's types, then by section code. */
export function sortSections(sections: readonly Section[], types: readonly EventType[]): Section[] {
  const typeOrder = (code: string) => {
    const i = types.findIndex((t) => t.code === code)
    return i === -1 ? types.length : i
  }
  const firstTime = (s: Section) => s.meetings[0]
  return sections.toSorted(
    (a, b) =>
      typeOrder(a.type_code) - typeOrder(b.type_code) ||
      a.type_code.localeCompare(b.type_code) ||
      a.section_code.localeCompare(b.section_code, undefined, { numeric: true }) ||
      (firstTime(a)?.weekday ?? 0) - (firstTime(b)?.weekday ?? 0) ||
      (firstTime(a)?.start_time ?? '').localeCompare(firstTime(b)?.start_time ?? ''),
  )
}

/**
 * A table row: the heading of a type's sections, a section, or one of its meetings. Meetings
 * are always rendered and fold to no height while their section is collapsed, so expanding
 * slides the rows below down instead of making them jump.
 */
type Row =
  | { kind: 'type'; id: string; type: string; count: number }
  | { kind: 'section'; id: string; section: Section }
  | { kind: 'meeting'; id: string; section: Section; meeting: Meeting }

const features = settingsTableFeatures
const column = createColumnHelper<typeof features, Row>()

type TableState = {
  types: readonly EventType[]
  sections: readonly Section[]
  conflicting: ReadonlySet<string>
  busy: boolean
  expanded: ReadonlySet<string>
  onExpand: (key: string) => void
  onToggle: (ids: string[], enabled: boolean) => void
  onKeepOnly: (keep: string[], others: string[]) => void
  onEdit: (section: Section, meeting: Meeting) => void
  onEditSection: (section: Section) => void
  onDeleteSection: (section: Section) => void
}

/** What the cells need; the columns live outside the component. */
const SectionsContext = createContext<TableState | null>(null)

function useSections(): TableState {
  const state = use(SectionsContext)
  if (!state) throw new Error('Section cells render inside a SectionsTable')
  return state
}

type CellProps = CellContext<typeof features, Row>

/** A switched-off section's or meeting's text is dimmed; its switch and menu stay readable. */
const dim = (on: boolean) => cn(!on && 'text-muted-foreground opacity-60')
const sectionOn = (section: Section) => section.meetings.some((mt) => mt.enabled)
const sectionName = (section: Section) => sectionLabel(section)

/** The heading row of a type: its name and how many sections it has, over the whole width. */
function TypeHeading({ code, count }: { code: string; count: number }) {
  const { types } = useSections()
  const type = types.find((t) => t.code === code)
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="font-medium text-foreground">{type ? typeName(type) : code}</span>
      <span className="text-muted-foreground tabular-nums">{count}</span>
    </div>
  )
}

/**
 * A meeting row's content, folded to no height while its section is collapsed (grid rows from
 * 0fr to 1fr, so the height follows the content) and out of the tab order then.
 */
function Reveal({ row, children }: { row: Row; children: ReactNode }) {
  const { expanded } = useSections()
  if (row.kind !== 'meeting') return children
  const open = expanded.has(row.section.id)
  return (
    <div
      inert={!open}
      aria-hidden={!open || undefined}
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
      )}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="flex h-14 items-center">{children}</div>
      </div>
    </div>
  )
}

function ExpandCell({ row }: CellProps) {
  const { expanded, onExpand } = useSections()
  const r = row.original
  if (r.kind === 'type') return <TypeHeading code={r.type} count={r.count} />
  if (r.kind !== 'section') return null
  const open = expanded.has(r.section.id)
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-expanded={open}
      aria-label={
        open
          ? m.schedule_section_collapse({ section: sectionName(r.section) })
          : m.schedule_section_expand({ section: sectionName(r.section) })
      }
      onClick={() => onExpand(r.section.id)}
    >
      <ChevronRight
        aria-hidden
        className={cn('transition-transform duration-200', open && 'rotate-90')}
      />
    </Button>
  )
}

function SwitchCell({ row }: CellProps) {
  const { busy, onToggle } = useSections()
  const r = row.original
  if (r.kind === 'type') return null
  if (r.kind === 'section') {
    const own = r.section.meetings
    return (
      <Switch
        aria-label={m.schedule_enable_section({ name: sectionName(r.section) })}
        checked={sectionOn(r.section)}
        disabled={busy}
        onCheckedChange={(next) =>
          onToggle(
            own.map((mt) => mt.id),
            next,
          )
        }
      />
    )
  }
  // A meeting's switch is the small size, centred under its section's (w-11 vs w-7).
  return (
    <Reveal row={r}>
      <Switch
        size="sm"
        className="ml-2"
        aria-label={m.schedule_enable_meeting({
          day: weekdayName(r.meeting.weekday),
          time: formatTime(r.meeting.start_time),
        })}
        checked={r.meeting.enabled}
        disabled={busy}
        onCheckedChange={(on) => onToggle([r.meeting.id], on)}
      />
    </Reveal>
  )
}

function SectionCell({ row }: CellProps) {
  const { conflicting } = useSections()
  const r = row.original
  if (r.kind !== 'section') return null
  const { section } = r
  // The type is the heading of the group; the second line only has the instructor.
  return (
    <div className={cn('min-w-0', dim(sectionOn(section)))}>
      <div className="flex items-center gap-2 font-medium">
        <span className="truncate">{section.section_code || '—'}</span>
        {section.meetings.some((mt) => conflicting.has(mt.id)) ? (
          <Badge variant="destructive">{m.schedule_conflict()}</Badge>
        ) : null}
      </div>
      {section.instructor ? (
        <div className="truncate text-xs text-muted-foreground">{section.instructor}</div>
      ) : null}
    </div>
  )
}

function TimeCell({ row }: CellProps) {
  const r = row.original
  if (r.kind === 'type') return null
  if (r.kind === 'section') {
    return (
      <span className={cn('block truncate tabular-nums', dim(sectionOn(r.section)))}>
        {timesSummary(r.section.meetings)}
      </span>
    )
  }
  return (
    <Reveal row={r}>
      <span className={cn('block truncate tabular-nums', dim(r.meeting.enabled))}>
        {weekdayName(r.meeting.weekday, 'short')} {timeRange(r.meeting)}
      </span>
    </Reveal>
  )
}

function LocationCell({ row }: CellProps) {
  const r = row.original
  if (r.kind === 'type') return null
  if (r.kind === 'section') {
    const places = [...new Set(r.section.meetings.map((mt) => mt.location).filter(Boolean))]
    return (
      <span className={cn('block truncate', dim(sectionOn(r.section)))}>
        {places.join(m.schedule_list_separator()) || '—'}
      </span>
    )
  }
  return (
    <Reveal row={r}>
      <span className={cn('block truncate', dim(r.meeting.enabled))}>
        {r.meeting.location || '—'}
      </span>
    </Reveal>
  )
}

/** The section's weeks, which all of its times share. */
function WeeksCell({ row }: CellProps) {
  const r = row.original
  if (r.kind !== 'section') return null
  return (
    <span className={cn('block truncate', dim(sectionOn(r.section)))}>{weeksText(r.section)}</span>
  )
}

function ActionsCell({ row }: CellProps) {
  const { sections, onEdit, onEditSection, onDeleteSection, onKeepOnly } = useSections()
  const r = row.original
  if (r.kind === 'type') return null
  if (r.kind === 'meeting') {
    return (
      <Reveal row={r}>
        <RowMenu
          label={m.schedule_meeting_actions({
            section: sectionName(r.section),
            day: weekdayName(r.meeting.weekday),
          })}
        >
          <DropdownMenuItem onClick={() => onEdit(r.section, r.meeting)}>
            <Pencil aria-hidden />
            {m.schedule_meeting_edit()}
          </DropdownMenuItem>
        </RowMenu>
      </Reveal>
    )
  }
  const { section } = r
  const own = section.meetings
  // "Keep only this one" switches off the other sections of the same type.
  const others = sections
    .filter((s) => s.id !== section.id && s.type_code === section.type_code)
    .flatMap((s) => s.meetings)
  return (
    <RowMenu label={m.schedule_section_actions({ section: sectionName(section) })}>
      <DropdownMenuItem onClick={() => onEditSection(section)}>
        <Pencil aria-hidden />
        {m.schedule_section_edit()}
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
  )
}

const columns = column.columns([
  column.display({
    id: 'expand',
    header: () => <span className="sr-only">{m.schedule_section_times()}</span>,
    cell: ExpandCell,
  }),
  column.display({
    id: 'on',
    header: () => <span className="sr-only">{m.schedule_enabled()}</span>,
    cell: SwitchCell,
  }),
  column.display({ id: 'section', header: () => m.schedule_section_code(), cell: SectionCell }),
  column.display({ id: 'time', header: () => m.schedule_section_times(), cell: TimeCell }),
  column.display({ id: 'location', header: () => m.schedule_location(), cell: LocationCell }),
  column.display({ id: 'weeks', header: () => m.schedule_weeks(), cell: WeeksCell }),
  column.display({ id: 'actions', header: ActionsHeader, cell: ActionsCell }),
])

const COLUMN_CLASS: Record<string, string> = {
  expand: 'w-10 pr-0 pl-2',
  on: 'w-20 min-w-20',
  section: 'w-52 min-w-52 max-w-52',
  time: 'w-72 min-w-72 max-w-72',
  location: 'w-full max-w-0',
  weeks: 'w-48 min-w-48',
  actions: 'w-10',
}

/** A cell of a meeting row folds with its content: no padding or height of its own. */
const FOLD = 'h-auto py-0'

/**
 * The course's sections in one table (M04 §5.3), grouped by type under a heading row: a row per
 * section with its times summed up; expanding a section lists its meetings, each with its own
 * switch and menu.
 */
export function SectionsTable({
  types,
  sections: unsorted,
  ...state
}: Omit<TableState, 'expanded' | 'onExpand'>) {
  const sections = sortSections(unsorted, types)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const onExpand = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })
  const count = (code: string) => sections.filter((s) => s.type_code === code).length
  const rows: Row[] = sections.flatMap((section, i) => [
    ...(sections[i - 1]?.type_code === section.type_code
      ? []
      : [
          {
            kind: 'type' as const,
            id: `t:${section.type_code}`,
            type: section.type_code,
            count: count(section.type_code),
          },
        ]),
    { kind: 'section' as const, id: `s:${section.id}`, section },
    ...section.meetings.map((meeting) => ({
      kind: 'meeting' as const,
      id: `m:${meeting.id}`,
      section,
      meeting,
    })),
  ])
  const last = sections.at(-1)
  return (
    <SectionsContext value={{ ...state, types, sections, expanded, onExpand }}>
      <SettingsTable
        label={m.schedule_meetings()}
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        columnClassName={COLUMN_CLASS}
        rowClassName={(r) => {
          if (r.kind === 'type') return 'bg-muted/50'
          if (r.kind === 'meeting') {
            return expanded.has(r.section.id) ? 'bg-muted/40' : 'border-b-0'
          }
          // The table's frame closes the last section while its times are folded away.
          return r.section === last && !expanded.has(r.section.id) ? 'border-b-0' : undefined
        }}
        cellSpan={(columnId, r) => {
          if (r.kind === 'type') {
            return columnId === 'expand' ? { colSpan: columns.length, className: 'h-9 pl-4' } : null
          }
          return r.kind === 'meeting' ? { className: FOLD } : undefined
        }}
      />
    </SectionsContext>
  )
}
