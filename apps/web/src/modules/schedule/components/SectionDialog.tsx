import type { Section } from '@semestra/api-client'
import { scheduleSectionSaveMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type CellContext, createColumnHelper, useTable } from '@tanstack/react-table'
import { Clock2, Plus, Trash2 } from 'lucide-react'
import { createContext, type FormEvent, use, useId, useState } from 'react'
import {
  ActionRow,
  ChoiceControl,
  SettingRow,
  SettingsGroup,
  settingsTableFeatures,
} from '@/app/settings'
import { toastError } from '@/lib/errors'
import { TIME_INPUT } from '@/lib/time-input'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog'
import { Field, FieldError, FieldLabel } from '@/ui/field'
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { typeName } from '../labels'
import { invalidateSchedule, useEventTypes } from '../queries'
import { wholeTerm } from '../sections'
import { weekdayName } from '../time'

/** A time row; `id` is the meeting it edits, absent for a new one. */
type Time = {
  key: number
  id?: string
  weekday: string
  start: string
  end: string
  location: string
}

/** A new time starts from the last one: same hours and room, the next day. */
function nextTime(all: readonly Time[]): Time {
  const last = all.at(-1)
  if (!last) return { key: 0, weekday: '1', start: '09:00', end: '10:00', location: '' }
  return {
    ...last,
    id: undefined,
    key: Math.max(...all.map((t) => t.key)) + 1,
    weekday: String((Number(last.weekday) % 7) + 1),
  }
}

const int = (value: string) => (value.trim() === '' ? null : Number.parseInt(value, 10))

/** The section's weeks: the whole term (every week, breaks skipped) or set weeks. */
type WeeksMode = 'term' | 'custom'

// ---- The times table: TanStack Table, columns outside the component, rows edited via context.

type TimesState = {
  invalid: ReadonlySet<number>
  single: boolean
  set: (key: number, patch: Partial<Time>) => void
  remove: (key: number) => void
}

const TimesContext = createContext<TimesState | null>(null)

function useTimes(): TimesState {
  const state = use(TimesContext)
  if (!state) throw new Error('Time cells render inside the section dialog')
  return state
}

const timeFeatures = settingsTableFeatures
const timeColumn = createColumnHelper<typeof timeFeatures, Time>()
type TimeCellProps = CellContext<typeof timeFeatures, Time>

function WeekdayCell({ row }: TimeCellProps) {
  const { set } = useTimes()
  const t = row.original
  const weekdays = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: String(d), label: weekdayName(d) }))
  return (
    <Select
      value={t.weekday}
      items={weekdays}
      onValueChange={(v) => v && set(t.key, { weekday: v })}
    >
      <SelectTrigger aria-label={m.schedule_weekday()} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {weekdays.map((d) => (
            <SelectItem key={d.value} value={d.value}>
              {d.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function clockCell(field: 'start' | 'end', label: () => string) {
  return function ClockCell({ row }: TimeCellProps) {
    const { invalid, set } = useTimes()
    const t = row.original
    return (
      <InputGroup>
        <InputGroupInput
          type="time"
          aria-label={label()}
          aria-invalid={invalid.has(t.key) || undefined}
          className={TIME_INPUT}
          value={t[field]}
          onChange={(e) => set(t.key, { [field]: e.target.value })}
        />
        <InputGroupAddon>
          <Clock2 aria-hidden />
        </InputGroupAddon>
      </InputGroup>
    )
  }
}

function LocationCell({ row }: TimeCellProps) {
  const { set } = useTimes()
  const t = row.original
  return (
    <Input
      aria-label={m.schedule_location()}
      placeholder={m.schedule_location()}
      value={t.location}
      onChange={(e) => set(t.key, { location: e.target.value })}
    />
  )
}

function RemoveCell({ row }: TimeCellProps) {
  const { single, remove } = useTimes()
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="destructive"
      aria-label={m.schedule_section_time_remove()}
      disabled={single}
      onClick={() => remove(row.original.key)}
    >
      <Trash2 aria-hidden />
    </Button>
  )
}

const timeColumns = timeColumn.columns([
  timeColumn.display({ id: 'weekday', header: () => m.schedule_weekday(), cell: WeekdayCell }),
  timeColumn.display({
    id: 'start',
    header: () => m.schedule_start_time(),
    cell: clockCell('start', () => m.schedule_start_time()),
  }),
  timeColumn.display({
    id: 'end',
    header: () => m.schedule_end_time(),
    cell: clockCell('end', () => m.schedule_end_time()),
  }),
  timeColumn.display({ id: 'location', header: () => m.schedule_location(), cell: LocationCell }),
  timeColumn.display({
    id: 'remove',
    header: () => <span className="sr-only">{m.schedule_section_time_remove()}</span>,
    cell: RemoveCell,
  }),
])

const TIME_COLUMN_CLASS: Record<string, string> = {
  weekday: 'w-32',
  start: 'w-32',
  end: 'w-32',
  location: 'w-full',
  remove: 'w-10',
}

/** The section's times; "Add a time" is the table's last row, so adding opens nothing new. */
function TimesTable({
  times,
  state,
  onAdd,
}: {
  times: Time[]
  state: TimesState
  onAdd: () => void
}) {
  const table = useTable({
    features: timeFeatures,
    columns: timeColumns,
    data: times,
    getRowId: (t) => String(t.key),
  })
  return (
    <TimesContext value={state}>
      <div className="overflow-hidden rounded-2xl border">
        <Table aria-label={m.schedule_section_times()}>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="hover:bg-transparent">
                {group.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={`h-9 text-xs font-normal text-muted-foreground first:pl-3 last:pr-2 ${TIME_COLUMN_CLASS[header.column.id] ?? ''}`}
                  >
                    <table.FlexRender header={header} />
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                className="animate-in fade-in duration-200 hover:bg-transparent"
              >
                {row.getAllCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={`py-2 first:pl-3 last:pr-2 ${TIME_COLUMN_CLASS[cell.column.id] ?? ''}`}
                  >
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={table.getAllLeafColumns().length} className="p-1">
                <ActionRow icon={Plus} onClick={onAdd}>
                  {m.schedule_section_add_time()}
                </ActionRow>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </TimesContext>
  )
}

/**
 * Adds or edits a section (M04 §5.3): what a timetable lists as "LEC0101 — Mon, Wed 10:00".
 * The section owns its type, code, instructor and weeks; each of its times only has a day, hours
 * and a room. The weeks stay hidden behind "Whole term" until someone picks set weeks.
 */
export function SectionDialog({
  programId,
  courseId,
  termId,
  typeCode,
  section,
  withNewTime = false,
  open,
  onOpenChange,
}: {
  programId: string
  courseId: string
  termId: string
  typeCode: string
  /** The section when editing it. */
  section?: Section
  /** Opens with a new time after the section's own ("Add a time" of a section). */
  withNewTime?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const fid = useId()
  const queryClient = useQueryClient()
  const types = useEventTypes(programId).data?.items ?? []
  const editing = section !== undefined
  const [type, setType] = useState(section?.type_code ?? typeCode)
  const [code, setCode] = useState(section?.section_code ?? '')
  const [instructor, setInstructor] = useState(section?.instructor ?? '')
  const [times, setTimes] = useState<Time[]>(() => {
    if (!section) return [nextTime([])]
    const own = section.meetings.map((mt, key) => ({
      key,
      id: mt.id,
      weekday: String(mt.weekday),
      start: mt.start_time.slice(0, 5),
      end: mt.end_time.slice(0, 5),
      location: mt.location ?? '',
    }))
    return withNewTime ? [...own, nextTime(own)] : own
  })
  const [mode, setMode] = useState<WeeksMode>(section && !wholeTerm(section) ? 'custom' : 'term')
  const [recurrence, setRecurrence] = useState<'weekly' | 'biweekly'>(
    section?.recurrence ?? 'weekly',
  )
  const [anchorWeek, setAnchorWeek] = useState(String(section?.anchor_week ?? 1))
  const [startWeek, setStartWeek] = useState(String(section?.start_week ?? 1))
  const [endWeek, setEndWeek] = useState(section?.end_week != null ? String(section.end_week) : '')
  const [skipBreaks, setSkipBreaks] = useState(section?.skip_breaks ?? true)
  const [touched, setTouched] = useState(false)

  // One request for the whole section (`schedule.section.save`): its times are updated,
  // added and deleted together, so a failed save leaves nothing half done.
  const save = useMutation({
    ...scheduleSectionSaveMutation(),
    onError: toastError,
    onSettled: () => invalidateSchedule(queryClient),
    onSuccess: () => onOpenChange(false),
  })

  const start = int(startWeek)
  const end = int(endWeek)
  const weeksInvalid =
    mode === 'custom' && (start === null || start < 1 || (end !== null && end < start))
  const badTimes = new Set(
    times.filter((t) => !t.start || !t.end || t.start >= t.end).map((t) => t.key),
  )

  const weeks = () => {
    if (mode === 'term') {
      return {
        recurrence: 'weekly' as const,
        anchor_week: null,
        start_week: 1,
        end_week: null,
        skip_breaks: true,
      }
    }
    return {
      recurrence,
      anchor_week: recurrence === 'biweekly' ? (int(anchorWeek) ?? 1) : null,
      start_week: start ?? 1,
      end_week: end,
      skip_breaks: skipBreaks,
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (weeksInvalid || badTimes.size > 0) return
    save.mutate({
      path: { course_id: courseId },
      body: {
        section_id: section?.id ?? null,
        term_id: section?.term_id ?? termId,
        type_code: type,
        section_code: code.trim(),
        instructor: instructor.trim() || null,
        weeks: weeks(),
        times: times.map((t) => ({
          meeting_id: t.id ?? null,
          weekday: Number(t.weekday),
          start_time: t.start,
          end_time: t.end,
          location: t.location.trim() || null,
        })),
      },
    })
  }

  const timesState: TimesState = {
    invalid: touched ? badTimes : new Set(),
    single: times.length === 1,
    set: (key, patch) =>
      setTimes((all) => all.map((t) => (t.key === key ? { ...t, ...patch } : t))),
    remove: (key) => setTimes((all) => all.filter((t) => t.key !== key)),
  }

  const typeItems = types.map((t) => ({ value: t.code, label: `${t.code} · ${typeName(t)}` }))
  if (!typeItems.some((o) => o.value === type)) typeItems.push({ value: type, label: type })
  const modes = [
    { value: 'term' as const, label: m.schedule_weeks_whole_term() },
    { value: 'custom' as const, label: m.schedule_weeks_custom() },
  ]

  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? m.schedule_section_edit() : m.schedule_section_new_title()}
          </DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="flex min-h-0 flex-col gap-6">
          <div className="-mx-1 flex min-h-0 flex-col gap-6 overflow-y-auto px-1">
            <div className="grid grid-cols-3 gap-4">
              <Field>
                <FieldLabel htmlFor={`${fid}-type`}>{m.schedule_type()}</FieldLabel>
                <Select
                  value={type}
                  items={typeItems}
                  onValueChange={(next) => next && setType(next)}
                >
                  <SelectTrigger id={`${fid}-type`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {typeItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${fid}-code`}>{m.schedule_section_code()}</FieldLabel>
                <Input
                  id={`${fid}-code`}
                  placeholder={`${type}0101`}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${fid}-instructor`}>{m.schedule_instructor()}</FieldLabel>
                <Input
                  id={`${fid}-instructor`}
                  value={instructor}
                  onChange={(e) => setInstructor(e.target.value)}
                />
              </Field>
            </div>

            <section aria-labelledby={`${fid}-times`} className="space-y-3">
              <h3 id={`${fid}-times`} className="text-sm font-medium">
                {m.schedule_section_times()}
              </h3>
              <TimesTable
                times={times}
                state={timesState}
                onAdd={() => setTimes((all) => [...all, nextTime(all)])}
              />
              {touched && badTimes.size > 0 ? (
                <FieldError>{m.error_schedule_time_range_invalid()}</FieldError>
              ) : null}
            </section>

            <SettingsGroup>
              <SettingRow label={m.schedule_weeks()}>
                {(labelId) => (
                  <ChoiceControl<WeeksMode>
                    labelId={labelId}
                    value={mode}
                    onChange={setMode}
                    options={modes}
                  />
                )}
              </SettingRow>
              {mode === 'custom'
                ? [
                    <SettingRow
                      key="recurrence"
                      label={m.schedule_recurrence()}
                      className="animate-in fade-in slide-in-from-top-1 duration-200"
                    >
                      {(labelId) => (
                        <div className="flex items-center gap-2">
                          {recurrence === 'biweekly' ? (
                            <Input
                              type="number"
                              min={1}
                              aria-label={m.schedule_anchor_week()}
                              className="w-20"
                              value={anchorWeek}
                              onChange={(e) => setAnchorWeek(e.target.value)}
                            />
                          ) : null}
                          <ChoiceControl<'weekly' | 'biweekly'>
                            labelId={labelId}
                            value={recurrence}
                            onChange={setRecurrence}
                            options={[
                              { value: 'weekly', label: m.schedule_recurrence_weekly() },
                              { value: 'biweekly', label: m.schedule_recurrence_biweekly() },
                            ]}
                          />
                        </div>
                      )}
                    </SettingRow>,
                    <SettingRow
                      key="range"
                      label={m.schedule_weeks_span()}
                      description={
                        touched && weeksInvalid ? (
                          <span className="text-destructive">
                            {m.error_schedule_week_range_invalid()}
                          </span>
                        ) : undefined
                      }
                      className="animate-in fade-in slide-in-from-top-1 duration-200"
                    >
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Input
                          type="number"
                          min={1}
                          aria-label={m.schedule_start_week()}
                          aria-invalid={(touched && weeksInvalid) || undefined}
                          className="w-20"
                          value={startWeek}
                          onChange={(e) => setStartWeek(e.target.value)}
                        />
                        –
                        <Input
                          type="number"
                          min={1}
                          aria-label={m.schedule_end_week()}
                          aria-invalid={(touched && weeksInvalid) || undefined}
                          placeholder={m.schedule_end_week_placeholder()}
                          className="w-24"
                          value={endWeek}
                          onChange={(e) => setEndWeek(e.target.value)}
                        />
                      </div>
                    </SettingRow>,
                    <SettingRow
                      key="breaks"
                      label={m.schedule_skip_breaks()}
                      className="animate-in fade-in slide-in-from-top-1 duration-200"
                    >
                      {(labelId) => (
                        <Switch
                          aria-labelledby={labelId}
                          checked={skipBreaks}
                          onCheckedChange={setSkipBreaks}
                        />
                      )}
                    </SettingRow>,
                  ]
                : null}
            </SettingsGroup>
          </div>

          <DialogFooter>
            <DialogClose
              render={<Button type="button" variant="outline" disabled={save.isPending} />}
            >
              {m.common_cancel()}
            </DialogClose>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? m.common_saving() : m.common_save()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
