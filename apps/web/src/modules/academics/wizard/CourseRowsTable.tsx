import type { Course } from '@semestra/api-client'
import {
  type CellContext,
  createColumnHelper,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { Repeat, Trash2, Undo2 } from 'lucide-react'
import { createContext, use } from 'react'
import { formatCredits } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Input } from '@/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/ui/input-group'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import type { TermWizardImportSource } from '../types'
import { type DraftRow, creditsProblem, rowIsEmpty } from './draft'

/**
 * A row of the wizard's course table: a course typed or imported for the new term, or a
 * year-long course of the previous term that continues into it (read-only, can be left out).
 */
export type WizardRow =
  | { kind: 'draft'; row: DraftRow }
  | { kind: 'continue'; course: Course; kept: boolean }

const features = tableFeatures({})
const column = createColumnHelper<typeof features, WizardRow>()
type CellProps = CellContext<typeof features, WizardRow>

/**
 * The cells live at module level and read the callbacks from this context: a cell defined inside
 * the component would be a new function on every render, and `FlexRender` would remount it, which
 * drops focus from the input being typed in.
 */
type RowsState = {
  programId: string
  touched: boolean
  defaultCredits: number
  sources: readonly TermWizardImportSource[]
  onChange: (key: string, change: Partial<DraftRow>) => void
  onRemove: (key: string) => void
  /** Keeps or leaves out a continuing course. */
  onContinue: (courseId: string, kept: boolean) => void
}

const RowsContext = createContext<RowsState | null>(null)

function useRowsState(): RowsState {
  const state = use(RowsContext)
  if (!state) throw new Error('CourseRowsTable cells must render inside CourseRowsTable')
  return state
}

const rowKey = (r: WizardRow) => (r.kind === 'draft' ? r.row.key : `continue-${r.course.id}`)

/** Continuing rows that are left out are dimmed and struck through, not removed. */
const leftOut = (r: WizardRow) => r.kind === 'continue' && !r.kept

function CodeCell({ row }: CellProps) {
  const { onChange } = useRowsState()
  const r = row.original
  if (r.kind === 'continue') {
    return <span className="px-3 font-medium">{r.course.code}</span>
  }
  return (
    <Input
      aria-label={m.academics_wizard_row_code({ row: row.index + 1 })}
      placeholder="APS105H1"
      className="w-32"
      value={r.row.code}
      onChange={(event) => onChange(r.row.key, { code: event.target.value })}
    />
  )
}

function SourceMark({ sourceId }: { sourceId: string }) {
  const { programId, sources } = useRowsState()
  const source = sources.find((s) => s.id === sourceId)
  if (!source) return null
  const name = source.Title ? <source.Title programId={programId} /> : source.title()
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="flex" />}>
        <source.icon aria-hidden className="size-4" />
        <span className="sr-only">{name}</span>
      </TooltipTrigger>
      <TooltipContent>{name}</TooltipContent>
    </Tooltip>
  )
}

function TitleCell({ row }: CellProps) {
  const { touched, onChange } = useRowsState()
  const r = row.original
  if (r.kind === 'continue') {
    return (
      <div className="flex min-w-0 items-center gap-2 px-3">
        <span className="truncate">{r.course.title}</span>
        <Badge variant="secondary" className="shrink-0">
          <Repeat aria-hidden />
          {m.academics_wizard_continued_badge()}
        </Badge>
      </div>
    )
  }
  const missing = touched && !rowIsEmpty(r.row) && !r.row.title.trim()
  return (
    <InputGroup>
      <InputGroupInput
        aria-label={m.academics_wizard_row_title({ row: row.index + 1 })}
        aria-invalid={missing || undefined}
        value={r.row.title}
        onChange={(event) => onChange(r.row.key, { title: event.target.value })}
      />
      {r.row.sourceId ? (
        <InputGroupAddon align="inline-end">
          <SourceMark sourceId={r.row.sourceId} />
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  )
}

function CreditsCell({ row }: CellProps) {
  const { touched, defaultCredits, onChange } = useRowsState()
  const r = row.original
  if (r.kind === 'continue') {
    return <span className="px-3 text-muted-foreground">{formatCredits(r.course.credits)}</span>
  }
  const bad = touched && creditsProblem(r.row.credits)
  return (
    <Input
      type="number"
      inputMode="decimal"
      step="any"
      min={0}
      aria-label={m.academics_wizard_row_credits({ row: row.index + 1 })}
      aria-invalid={bad || undefined}
      placeholder={m.academics_wizard_credits_default({ credits: formatCredits(defaultCredits) })}
      className="w-28"
      value={r.row.credits}
      onChange={(event) => onChange(r.row.key, { credits: event.target.value })}
    />
  )
}

function YearLongCell({ row }: CellProps) {
  const { onChange } = useRowsState()
  const r = row.original
  if (r.kind === 'continue') {
    return (
      <Checkbox
        aria-label={m.academics_wizard_row_year_long({ row: row.index + 1 })}
        checked
        disabled
      />
    )
  }
  return (
    <Checkbox
      aria-label={m.academics_wizard_row_year_long({ row: row.index + 1 })}
      checked={r.row.yearLong}
      onCheckedChange={(on) => onChange(r.row.key, { yearLong: on })}
    />
  )
}

function RemoveCell({ row }: CellProps) {
  const { onRemove, onContinue } = useRowsState()
  const r = row.original
  if (r.kind === 'continue') {
    const label = r.kept
      ? m.academics_wizard_continue_skip({ name: r.course.code || r.course.title })
      : m.academics_wizard_continue_keep({ name: r.course.code || r.course.title })
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className={r.kept ? 'text-destructive hover:text-destructive' : undefined}
              aria-label={label}
              onClick={() => onContinue(r.course.id, !r.kept)}
            />
          }
        >
          {r.kept ? <Trash2 aria-hidden /> : <Undo2 aria-hidden />}
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="text-destructive hover:text-destructive"
      aria-label={m.academics_wizard_row_remove({ row: row.index + 1 })}
      onClick={() => onRemove(r.row.key)}
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

const HEAD_CLASS: Record<string, string> = {
  title: 'h-auto w-full py-2 text-muted-foreground',
  remove: 'h-auto w-10 py-2',
}
const CELL_CLASS: Record<string, string> = { yearLong: 'py-1.5', title: 'max-w-0 px-2 py-1.5' }

/**
 * The term wizard's courses: continuing year-long courses first, then the ones typed or
 * imported; each cell edits its row in place.
 */
export function CourseRowsTable({ rows, ...state }: RowsState & { rows: WizardRow[] }) {
  const table = useTable({ features, columns, data: rows, getRowId: rowKey })
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
            <TableRow
              key={row.id}
              className={cn(
                'h-14 hover:bg-transparent',
                leftOut(row.original) &&
                  '[&>td:not(:last-child)]:text-muted-foreground [&>td:not(:last-child)]:line-through [&>td:not(:last-child)]:opacity-60',
              )}
            >
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
