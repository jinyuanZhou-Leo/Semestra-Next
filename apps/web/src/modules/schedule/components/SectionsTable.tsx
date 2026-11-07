import type { EventType, Meeting, SectionTime } from '@semestra/api-client'
import { type CellContext, createColumnHelper } from '@tanstack/react-table'
import { ChevronRight, Clock2, ListFilter, Pencil, Plus, Trash2 } from 'lucide-react'
import { createContext, use, useState } from 'react'
import { RowMenu, SettingsTable, settingsTableFeatures } from '@/app/settings'
import { formatTime } from '@/lib/format'
import { TIME_INPUT } from '@/lib/time-input'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/ui/dropdown-menu'
import { Input } from '@/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/ui/input-group'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'
import { Switch } from '@/ui/switch'
import { typeName } from '../labels'
import { weekdayName } from '../time'
import { ActionsHeader } from './ActionsHeader'

/** A section (e.g. LEC0101) with its meetings, in weekday order. */
export type Section = { key: string; code: string; typeCode: string; meetings: Meeting[] }

/** Whether a time runs every week of the term, skipping breaks: the section dialog's default. */
export const wholeTerm = (mt: Meeting) =>
  mt.recurrence === 'weekly' && mt.start_week === 1 && mt.end_week == null && mt.skip_breaks

/** The weeks a meeting runs, e.g. "Biweekly (week 2) · Weeks 1–12". */
export function weeksText(mt: Meeting): string {
  if (wholeTerm(mt)) return m.schedule_weeks_whole_term()
  const range = mt.end_week
    ? m.schedule_weeks_range({ start: mt.start_week, end: mt.end_week })
    : m.schedule_weeks_from({ start: mt.start_week })
  return mt.recurrence === 'biweekly'
    ? `${m.schedule_recurrence_biweekly()} (${m.schedule_week_number({ number: mt.anchor_week })}) · ${range}`
    : range
}

const weeksKey = (mt: Meeting) =>
  [mt.recurrence, mt.anchor_week, mt.start_week, mt.end_week, mt.skip_breaks].join('|')

/** Whether the meetings of a section run in different weeks. */
export const weeksDiffer = (meetings: readonly Meeting[]) =>
  new Set(meetings.map(weeksKey)).size > 1

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

/** Groups meetings into sections, in the order of the Program's types, then by section code. */
export function sectionsOf(meetings: readonly Meeting[], types: readonly EventType[]): Section[] {
  const typeOrder = (code: string) => {
    const i = types.findIndex((t) => t.code === code)
    return i === -1 ? types.length : i
  }
  const sorted = meetings.toSorted(
    (a, b) =>
      typeOrder(a.type_code) - typeOrder(b.type_code) ||
      a.type_code.localeCompare(b.type_code) ||
      a.section_code.localeCompare(b.section_code, undefined, { numeric: true }) ||
      a.weekday - b.weekday ||
      a.start_time.localeCompare(b.start_time),
  )
  // A meeting without a section code is a section of its own.
  const sections: Section[] = []
  for (const mt of sorted) {
    const last = sections.at(-1)
    if (mt.section_code && last?.code === mt.section_code && last.typeCode === mt.type_code) {
      last.meetings.push(mt)
    } else {
      sections.push({ key: mt.id, code: mt.section_code, typeCode: mt.type_code, meetings: [mt] })
    }
  }
  return sections
}

/** A table row: a section, one of its meetings while it is expanded, or a time being added. */
type Row =
  | { kind: 'section'; id: string; section: Section }
  | { kind: 'meeting'; id: string; section: Section; meeting: Meeting }
  | { kind: 'draft'; id: string; section: Section }

/** The time being added to a section, edited in place under the section's times. */
type Draft = { weekday: string; start: string; end: string; location: string }

/** The day after the section's last time, at the same hours (or 09:00–10:00). */
function draftFor(section: Section): Draft {
  const last = section.meetings.at(-1)
  if (!last) return { weekday: '1', start: '09:00', end: '10:00', location: '' }
  return {
    weekday: String((last.weekday % 7) + 1),
    start: last.start_time.slice(0, 5),
    end: last.end_time.slice(0, 5),
    location: last.location ?? '',
  }
}

const draftInvalid = (d: Draft) => !d.start || !d.end || d.start >= d.end

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
  onEdit: (meeting: Meeting) => void
  onEditSection: (section: Section) => void
  onDeleteSection: (section: Section) => void
  /** Saves a new time for the section; it keeps the section's weeks. */
  onAddTime: (section: Section, time: SectionTime) => Promise<unknown>
  draft: Draft | null
  draftTouched: boolean
  draftSaving: boolean
  onStartDraft: (section: Section) => void
  onDraftChange: (patch: Partial<Draft>) => void
  onDraftCancel: () => void
  onDraftSave: () => void
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
const sectionName = (section: Section) => section.code || section.typeCode

function ExpandCell({ row }: CellProps) {
  const { expanded, onExpand } = useSections()
  const r = row.original
  if (r.kind !== 'section') return null
  const open = expanded.has(r.section.key)
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
      onClick={() => onExpand(r.section.key)}
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
  if (r.kind === 'draft') return null
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
  // A meeting's switch sits a little right of its section's, same size.
  return (
    <Switch
      className="ml-3"
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

/** Enter saves the new time, Escape drops it. */
function useDraftKeys() {
  const { onDraftSave, onDraftCancel } = useSections()
  return (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      onDraftSave()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onDraftCancel()
    }
  }
}

function DraftWeekday() {
  const { draft, onDraftChange } = useSections()
  const weekdays = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: String(d), label: weekdayName(d) }))
  if (!draft) return null
  return (
    <Select
      value={draft.weekday}
      items={weekdays}
      onValueChange={(next) => next && onDraftChange({ weekday: next })}
    >
      <SelectTrigger size="sm" aria-label={m.schedule_weekday()} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {weekdays.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function DraftTimes() {
  const { draft, draftTouched, onDraftChange } = useSections()
  const keys = useDraftKeys()
  if (!draft) return null
  const invalid = (draftTouched && draftInvalid(draft)) || undefined
  const input = (field: 'start' | 'end', label: string) => (
    <InputGroup className="h-8 min-w-0 flex-1">
      <InputGroupInput
        type="time"
        aria-label={label}
        aria-invalid={field === 'end' ? invalid : undefined}
        className={TIME_INPUT}
        value={draft[field]}
        onChange={(e) => onDraftChange({ [field]: e.target.value })}
        onKeyDown={keys}
      />
      <InputGroupAddon>
        <Clock2 aria-hidden />
      </InputGroupAddon>
    </InputGroup>
  )
  return (
    <div className="flex items-center gap-1.5">
      {input('start', m.schedule_start_time())}
      <span aria-hidden className="text-muted-foreground">
        –
      </span>
      {input('end', m.schedule_end_time())}
    </div>
  )
}

function DraftLocation() {
  const { draft, onDraftChange } = useSections()
  const keys = useDraftKeys()
  if (!draft) return null
  return (
    <Input
      aria-label={m.schedule_location()}
      className="h-8 w-full"
      value={draft.location}
      onChange={(e) => onDraftChange({ location: e.target.value })}
      onKeyDown={keys}
    />
  )
}

function DraftActions() {
  const { draftSaving, onDraftCancel, onDraftSave } = useSections()
  return (
    <div className="flex justify-end gap-2">
      <Button size="sm" variant="ghost" disabled={draftSaving} onClick={onDraftCancel}>
        {m.common_cancel()}
      </Button>
      <Button size="sm" disabled={draftSaving} onClick={onDraftSave}>
        {draftSaving ? m.common_saving() : m.common_save()}
      </Button>
    </div>
  )
}

function SectionCell({ row }: CellProps) {
  const { types, conflicting } = useSections()
  const r = row.original
  if (r.kind === 'draft') return <DraftWeekday />
  if (r.kind !== 'section') return null
  const { section } = r
  const type = types.find((t) => t.code === section.typeCode)
  const instructor = section.meetings.find((mt) => mt.instructor)?.instructor
  const detail = [type ? typeName(type) : section.typeCode, instructor].filter(Boolean).join(' · ')
  return (
    <div className={cn('min-w-0', dim(sectionOn(section)))}>
      <div className="flex items-center gap-2 font-medium">
        <span className="truncate">{section.code || '—'}</span>
        {section.meetings.some((mt) => conflicting.has(mt.id)) ? (
          <Badge variant="destructive">{m.schedule_conflict()}</Badge>
        ) : null}
      </div>
      <div className="truncate text-xs text-muted-foreground">{detail}</div>
    </div>
  )
}

function TimeCell({ row }: CellProps) {
  const r = row.original
  if (r.kind === 'draft') return <DraftTimes />
  if (r.kind === 'section') {
    return (
      <span className={cn('block truncate tabular-nums', dim(sectionOn(r.section)))}>
        {timesSummary(r.section.meetings)}
      </span>
    )
  }
  return (
    <span className={cn('block truncate tabular-nums', dim(r.meeting.enabled))}>
      {weekdayName(r.meeting.weekday, 'short')} {timeRange(r.meeting)}
    </span>
  )
}

function LocationCell({ row }: CellProps) {
  const r = row.original
  if (r.kind === 'draft') return <DraftLocation />
  if (r.kind === 'section') {
    const places = [...new Set(r.section.meetings.map((mt) => mt.location).filter(Boolean))]
    return (
      <span className={cn('block truncate', dim(sectionOn(r.section)))}>
        {places.join(m.schedule_list_separator()) || '—'}
      </span>
    )
  }
  return (
    <span className={cn('block truncate', dim(r.meeting.enabled))}>
      {r.meeting.location || '—'}
    </span>
  )
}

/** A section's weeks; when its meetings differ, each meeting shows its own. */
function WeeksCell({ row }: CellProps) {
  const r = row.original
  if (r.kind === 'draft') return <DraftActions />
  const differ = weeksDiffer(r.section.meetings)
  if (r.kind === 'section') {
    const first = r.section.meetings[0]
    return (
      <span className={cn('block truncate', dim(sectionOn(r.section)))}>
        {differ || !first ? m.schedule_weeks_vary() : weeksText(first)}
      </span>
    )
  }
  return differ ? (
    <span className={cn('block truncate', dim(r.meeting.enabled))}>{weeksText(r.meeting)}</span>
  ) : null
}

function ActionsCell({ row }: CellProps) {
  const { sections, onEdit, onEditSection, onDeleteSection, onKeepOnly, onStartDraft } =
    useSections()
  const r = row.original
  if (r.kind === 'draft') return null
  if (r.kind === 'meeting') {
    return (
      <RowMenu
        label={m.schedule_meeting_actions({
          section: sectionName(r.section),
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
  const { section } = r
  const own = section.meetings
  // "Keep only this one" switches off the other sections of the same type.
  const others = sections
    .filter((s) => s !== section && s.typeCode === section.typeCode)
    .flatMap((s) => s.meetings)
  return (
    <RowMenu label={m.schedule_section_actions({ section: sectionName(section) })}>
      <DropdownMenuItem onClick={() => onEditSection(section)}>
        <Pencil aria-hidden />
        {m.schedule_section_edit()}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => onStartDraft(section)}>
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
  on: 'w-14',
  section: 'w-52 min-w-52 max-w-52',
  time: 'w-72 min-w-72 max-w-72',
  location: 'w-full max-w-0',
  weeks: 'w-48 min-w-48',
  actions: 'w-10',
}

/**
 * The course's sections in one table (M04 §5.3): a row per section with its times summed up;
 * expanding a section lists its meetings, each with its own switch and menu. "Add a time" opens
 * an editable row under the section's times, so adding one needs no dialog.
 */
export function SectionsTable({
  types,
  meetings,
  onAddTime,
  ...state
}: Omit<
  TableState,
  | 'sections'
  | 'expanded'
  | 'onExpand'
  | 'draft'
  | 'draftTouched'
  | 'draftSaving'
  | 'onStartDraft'
  | 'onDraftChange'
  | 'onDraftCancel'
  | 'onDraftSave'
> & { meetings: readonly Meeting[] }) {
  const sections = sectionsOf(meetings, types)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [adding, setAdding] = useState<{ key: string; draft: Draft; touched: boolean } | null>(null)
  const [saving, setSaving] = useState(false)
  const onExpand = (key: string) => {
    if (adding?.key === key) setAdding(null)
    setExpanded((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }
  const addingTo = adding ? sections.find((s) => s.key === adding.key) : undefined
  const onStartDraft = (section: Section) => {
    setExpanded((prev) => new Set(prev).add(section.key))
    setAdding({ key: section.key, draft: draftFor(section), touched: false })
  }
  const onDraftSave = async () => {
    if (!adding || !addingTo || saving) return
    if (draftInvalid(adding.draft)) {
      setAdding({ ...adding, touched: true })
      return
    }
    setSaving(true)
    const ok = await onAddTime(addingTo, {
      meeting_id: null,
      weekday: Number(adding.draft.weekday),
      start_time: adding.draft.start,
      end_time: adding.draft.end,
      location: adding.draft.location.trim() || null,
    }).then(
      () => true,
      () => false,
    )
    setSaving(false)
    if (ok) setAdding(null)
  }
  const rows: Row[] = sections.flatMap((section) => [
    { kind: 'section' as const, id: `s:${section.key}`, section },
    ...(expanded.has(section.key)
      ? section.meetings.map((meeting) => ({
          kind: 'meeting' as const,
          id: `m:${meeting.id}`,
          section,
          meeting,
        }))
      : []),
    ...(addingTo === section ? [{ kind: 'draft' as const, id: `d:${section.key}`, section }] : []),
  ])
  return (
    <SectionsContext
      value={{
        ...state,
        types,
        sections,
        expanded,
        onExpand,
        onAddTime,
        draft: addingTo ? (adding?.draft ?? null) : null,
        draftTouched: adding?.touched ?? false,
        draftSaving: saving,
        onStartDraft,
        onDraftChange: (patch) =>
          setAdding((prev) => (prev ? { ...prev, draft: { ...prev.draft, ...patch } } : prev)),
        onDraftCancel: () => setAdding(null),
        onDraftSave: () => void onDraftSave(),
      }}
    >
      <SettingsTable
        label={m.schedule_meetings()}
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        columnClassName={COLUMN_CLASS}
        rowClassName={(r) =>
          r.kind === 'section'
            ? undefined
            : 'bg-muted/40 animate-in fade-in slide-in-from-top-1 duration-200'
        }
      />
    </SectionsContext>
  )
}
