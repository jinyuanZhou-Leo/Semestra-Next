import type { BreakIn } from '@semestra/api-client'
import { type CellContext, createColumnHelper } from '@tanstack/react-table'
import { Plus, Trash2 } from 'lucide-react'
import { createContext, use } from 'react'
import { ActionRow, SettingsTable, settingsTableFeatures } from '@/app/settings'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { DateRangeField } from './DateRangeField'

/** A break with its position: breaks have no id until saved, so the row id is the index. */
type Row = { index: number; value: BreakIn }
type CellProps = CellContext<typeof settingsTableFeatures, Row>

/**
 * The cells live at module level and read the callbacks from this context: a cell defined inside
 * the component would be a new function on every render, and the table would remount it, which
 * drops focus from the name being typed.
 */
type BreaksState = {
  min?: string
  max?: string
  update: (index: number, patch: Partial<BreakIn>) => void
  remove: (index: number) => void
}

const BreaksContext = createContext<BreaksState | null>(null)

function useBreaks(): BreaksState {
  const state = use(BreaksContext)
  if (!state) throw new Error('BreaksTable cells must render inside BreaksTable')
  return state
}

function NameCell({ row }: CellProps) {
  const { update } = useBreaks()
  return (
    <Input
      aria-label={m.academics_break_name()}
      placeholder={m.academics_break_name_placeholder()}
      className="w-full"
      value={row.original.value.name}
      onChange={(event) => update(row.original.index, { name: event.target.value })}
    />
  )
}

function DatesCell({ row }: CellProps) {
  const { min, max, update } = useBreaks()
  const b = row.original.value
  return (
    <DateRangeField
      label={m.academics_break_dates({ name: b.name || m.academics_break_name() })}
      className="w-full"
      start={b.start_date}
      end={b.end_date}
      min={min}
      max={max}
      short
      align="end"
      onChange={(start_date, end_date) => update(row.original.index, { start_date, end_date })}
    />
  )
}

function RemoveCell({ row }: CellProps) {
  const { remove } = useBreaks()
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="text-destructive hover:text-destructive"
      aria-label={m.academics_break_remove({
        name: row.original.value.name || m.academics_break_name(),
      })}
      onClick={() => remove(row.original.index)}
    >
      <Trash2 aria-hidden />
    </Button>
  )
}

const RemoveHeader = () => <span className="sr-only">{m.common_remove()}</span>

const column = createColumnHelper<typeof settingsTableFeatures, Row>()
const columns = column.columns([
  column.display({ id: 'name', header: () => m.academics_break_name_header(), cell: NameCell }),
  column.display({ id: 'dates', header: () => m.academics_break_dates_header(), cell: DatesCell }),
  column.display({ id: 'remove', header: RemoveHeader, cell: RemoveCell }),
])

// Fixed widths, so the header sits in the same place with or without breaks.
const COLUMN_CLASS = {
  name: 'w-full max-w-0 pl-2',
  dates: 'w-64 min-w-64',
  remove: 'w-14 min-w-14',
}

/**
 * Reading weeks and holidays of a term (M02 §2): a name and an inclusive date range each, in a
 * settings table. Removing an unsaved row needs no confirmation (it is part of the form).
 */
export function BreaksTable({
  value,
  onChange,
  min,
  max,
}: {
  value: readonly BreakIn[]
  onChange: (value: BreakIn[]) => void
  /** The term's dates; days outside them cannot be picked. */
  min?: string
  max?: string
}) {
  const state: BreaksState = {
    min,
    max,
    update: (index, patch) => onChange(value.map((b, i) => (i === index ? { ...b, ...patch } : b))),
    remove: (index) => onChange(value.filter((_, i) => i !== index)),
  }
  return (
    <BreaksContext value={state}>
      <SettingsTable
        label={m.academics_term_breaks()}
        data={value.map((b, index) => ({ index, value: b }))}
        columns={columns}
        getRowId={(row) => String(row.index)}
        columnClassName={COLUMN_CLASS}
        footer={
          <ActionRow
            icon={Plus}
            onClick={() => onChange([...value, { name: '', start_date: '', end_date: '' }])}
          >
            {m.academics_break_add()}
          </ActionRow>
        }
      />
    </BreaksContext>
  )
}

/** Breaks the API accepts: named, with both dates. Half-filled rows stay out of a save. */
export function completeBreaks(breaks: readonly BreakIn[]): BreakIn[] {
  return breaks.filter((b) => b.name.trim() && b.start_date && b.end_date)
}
