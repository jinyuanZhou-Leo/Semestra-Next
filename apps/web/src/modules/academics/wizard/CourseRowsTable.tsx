import {
  type CellContext,
  createColumnHelper,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { Trash2 } from 'lucide-react'
import { createContext, use } from 'react'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Input } from '@/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { type DraftRow, creditsProblem, rowIsEmpty } from './draft'

const features = tableFeatures({})
const column = createColumnHelper<typeof features, DraftRow>()
type CellProps = CellContext<typeof features, DraftRow>

/**
 * The cells live at module level and read the callbacks from this context: a cell defined inside
 * the component would be a new function on every render, and `FlexRender` would remount it, which
 * drops focus from the input being typed in.
 */
type RowsState = {
  touched: boolean
  defaultCredits: number
  onChange: (key: string, change: Partial<DraftRow>) => void
  onRemove: (key: string) => void
}

const RowsContext = createContext<RowsState | null>(null)

function useRowsState(): RowsState {
  const state = use(RowsContext)
  if (!state) throw new Error('CourseRowsTable cells must render inside CourseRowsTable')
  return state
}

function CodeCell({ row }: CellProps) {
  const { onChange } = useRowsState()
  return (
    <Input
      aria-label={m.academics_wizard_row_code({ row: row.index + 1 })}
      placeholder="APS105H1"
      className="w-32"
      value={row.original.code}
      onChange={(event) => onChange(row.original.key, { code: event.target.value })}
    />
  )
}

function TitleCell({ row }: CellProps) {
  const { touched, onChange } = useRowsState()
  const missing = touched && !rowIsEmpty(row.original) && !row.original.title.trim()
  return (
    <Input
      aria-label={m.academics_wizard_row_title({ row: row.index + 1 })}
      aria-invalid={missing || undefined}
      value={row.original.title}
      onChange={(event) => onChange(row.original.key, { title: event.target.value })}
    />
  )
}

function CreditsCell({ row }: CellProps) {
  const { touched, defaultCredits, onChange } = useRowsState()
  const bad = touched && creditsProblem(row.original.credits)
  return (
    <Input
      type="number"
      inputMode="decimal"
      step="any"
      min={0}
      aria-label={m.academics_wizard_row_credits({ row: row.index + 1 })}
      aria-invalid={bad || undefined}
      placeholder={String(defaultCredits)}
      className="w-24"
      value={row.original.credits}
      onChange={(event) => onChange(row.original.key, { credits: event.target.value })}
    />
  )
}

function YearLongCell({ row }: CellProps) {
  const { onChange } = useRowsState()
  return (
    <Checkbox
      aria-label={m.academics_wizard_row_year_long({ row: row.index + 1 })}
      checked={row.original.yearLong}
      onCheckedChange={(on) => onChange(row.original.key, { yearLong: on })}
    />
  )
}

function RemoveCell({ row }: CellProps) {
  const { onRemove } = useRowsState()
  return (
    <Button
      variant="destructive"
      size="icon-sm"
      aria-label={m.academics_wizard_row_remove({ row: row.index + 1 })}
      onClick={() => onRemove(row.original.key)}
    >
      <Trash2 aria-hidden />
    </Button>
  )
}

const RemoveHeader = () => <span className="sr-only">{m.common_remove()}</span>

const columns = column.columns([
  column.display({ id: 'code', header: () => m.academics_course_code(), cell: CodeCell }),
  column.display({ id: 'title', header: () => m.academics_course_title(), cell: TitleCell }),
  column.display({ id: 'credits', header: () => m.academics_course_credits(), cell: CreditsCell }),
  column.display({
    id: 'yearLong',
    header: () => m.academics_course_year_long_short(),
    cell: YearLongCell,
  }),
  column.display({ id: 'remove', header: RemoveHeader, cell: RemoveCell }),
])

const HEAD_CLASS: Record<string, string> = { remove: 'h-auto w-10 py-2' }
const CELL_CLASS: Record<string, string> = { yearLong: 'py-1.5' }

/** The term wizard's course rows, typed or imported; each cell edits its row in place. */
export function CourseRowsTable({ rows, ...state }: RowsState & { rows: DraftRow[] }) {
  const table = useTable({ features, columns, data: rows, getRowId: (row) => row.key })
  return (
    <RowsContext value={state}>
      <Table>
        <TableHeader className="bg-muted/50">
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((h) => (
                <TableHead
                  key={h.id}
                  scope="col"
                  className={HEAD_CLASS[h.column.id] ?? 'h-auto py-2 text-muted-foreground'}
                >
                  <table.FlexRender header={h} />
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id} className="hover:bg-transparent">
              {row.getAllCells().map((cell) => (
                <TableCell key={cell.id} className={CELL_CLASS[cell.column.id] ?? 'px-2 py-1.5'}>
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </RowsContext>
  )
}
