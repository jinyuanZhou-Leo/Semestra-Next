import type { AssignmentOut, Quiz } from '@semestra/api-client'
import { lmsAssignmentListOptions, lmsQuizListOptions } from '@semestra/api-client/react-query'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  type CellContext,
  createColumnHelper,
  createSortedRowModel,
  type RowSelectionState,
  rowSelectionFeature,
  rowSortingFeature,
  type SortingState,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  GraduationCap,
  Import,
  ListChecks,
  Lock,
} from 'lucide-react'
import { createContext, Fragment, use, useState } from 'react'
import { toastError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import {
  type AssignmentImportKind,
  reviewAssignmentImport,
  startAssignmentImport,
} from '@/modules/lms/import/assignments'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Spinner } from '@/ui/spinner'
import { cn } from '@/lib/utils'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { CanvasBoundary } from '../CanvasBoundary'
import { useCanvasPage } from '../context'
import { AssignmentDetail } from './AssignmentDetail'
import { ScoreText, SubmissionStatus, ViewHeader } from './common'
import { useScrollIntoView } from './scroll'

/**
 * A row: a Canvas assignment (a graded quiz is one too, with its quiz alongside), or a practice
 * quiz, which has no assignment, no grade and can't be imported. Its id is the assignment's, or
 * `quiz:<id>` for a practice quiz.
 */
type Row = { id: string; assignment: AssignmentOut; quiz: Quiz | null; practice: boolean }

/** The id of a quiz's practice row, which is also its `ref` in the location (M16 §3). */
export const quizRef = (quizId: string) => `quiz:${quizId}`

const PRACTICE_GROUP = 'quiz:practice'

/** Assignments with their quizzes, then the practice quizzes as assignment-shaped rows. */
function rowsOf(assignments: readonly AssignmentOut[], quizzes: readonly Quiz[]): Row[] {
  const quizOf = new Map(quizzes.flatMap((q) => (q.assignment_id ? [[q.assignment_id, q]] : [])))
  const rows: Row[] = assignments.map((a) => ({
    id: a.external_id,
    assignment: a,
    quiz: quizOf.get(a.external_id) ?? null,
    practice: false,
  }))
  const graded = new Set(assignments.map((a) => a.external_id))
  for (const q of quizzes) {
    if (q.assignment_id && graded.has(q.assignment_id)) continue
    rows.push({
      id: quizRef(q.external_id),
      quiz: q,
      practice: true,
      assignment: {
        external_id: quizRef(q.external_id),
        web_url: q.web_url,
        name: q.title,
        html: q.html,
        due_at: q.due_at,
        unlock_at: q.unlock_at,
        lock_at: q.lock_at,
        points: q.points,
        group_id: PRACTICE_GROUP,
        group_name: m.canvas_tab_group_practice(),
        locked: q.locked,
        lock_explanation: q.lock_explanation,
        allowed_attempts: q.allowed_attempts,
        imported_as: [],
      },
    })
  }
  return rows
}

const features = tableFeatures({
  rowSortingFeature,
  rowSelectionFeature,
  sortedRowModel: createSortedRowModel(),
})
const column = createColumnHelper<typeof features, Row>()
type CellProps = CellContext<typeof features, Row>

/**
 * What the module-level cells read. The selection lives here, not only in the table: the React
 * Compiler keeps a cell whose `row` is the same object, so a cell reading `row.getIsSelected()`
 * would not update when only the selection changes.
 */
type TableState = {
  /** Read once, so "due in 3 days" doesn't change between renders. */
  now: number
  selected: RowSelectionState
  /** Rows that can still be imported, in the table's order. */
  selectable: readonly string[]
  setSelected: (ids: readonly string[], on: boolean) => void
}
const TableContext = createContext<TableState | null>(null)

function useTableState() {
  const state = use(TableContext)
  if (!state) throw new Error('assignment cells render inside AssignmentTable')
  return state
}

/** An assignment is imported once, as an assessment or as a task (M09 §11). */
const imported = (a: AssignmentOut) => a.imported_as.length > 0

/** A box that ticks several rows: all of them, or an assignment group's. */
function SelectMany({ ids, label }: { ids: readonly string[]; label: string }) {
  const { selected, setSelected } = useTableState()
  const ticked = ids.filter((id) => selected[id]).length
  return (
    <Checkbox
      aria-label={label}
      checked={ids.length > 0 && ticked === ids.length}
      indeterminate={ticked > 0 && ticked < ids.length}
      disabled={ids.length === 0}
      // Base UI's checkbox is a span, which the generated `disabled:` styles never match.
      className="data-disabled:cursor-not-allowed data-disabled:opacity-50"
      onCheckedChange={(on) => setSelected(ids, on)}
    />
  )
}

function SelectAllHeader() {
  const { selectable } = useTableState()
  return <SelectMany ids={selectable} label={m.canvas_tab_select_all()} />
}

function SelectCell({ row }: CellProps) {
  const { selected, setSelected } = useTableState()
  const { assignment: a, practice } = row.original
  if (practice) return null
  return (
    <Checkbox
      aria-label={m.canvas_tab_select_assignment({ name: a.name })}
      disabled={imported(a)}
      className="data-disabled:cursor-not-allowed data-disabled:opacity-50"
      checked={!!selected[row.id]}
      onCheckedChange={(on) => setSelected([row.id], on)}
      onClick={(event) => event.stopPropagation()}
    />
  )
}

function NameCell({ row }: CellProps) {
  const { assignment: a, quiz } = row.original
  const why = a.lock_explanation || m.canvas_tab_item_locked()
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      {quiz ? (
        <ListChecks
          aria-label={m.canvas_tab_quiz()}
          className="size-3.5 shrink-0 text-muted-foreground"
        />
      ) : null}
      <span className="font-medium">{a.name}</span>
      {a.locked ? (
        <Tooltip>
          <TooltipTrigger
            className="inline-flex rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            aria-label={why}
            onClick={(event) => event.stopPropagation()}
          >
            <Lock aria-hidden className="size-3.5 text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{why}</TooltipContent>
        </Tooltip>
      ) : null}
      {a.imported_as.some((t) => t.kind === 'assessment') ? (
        <Badge variant="secondary">{m.canvas_tab_in_gradebook()}</Badge>
      ) : null}
      {a.imported_as.some((t) => t.kind === 'task') ? (
        <Badge variant="secondary">{m.canvas_tab_in_tasks()}</Badge>
      ) : null}
    </span>
  )
}

const DueCell = ({ row }: CellProps) => (
  <span className="whitespace-nowrap">
    {row.original.assignment.due_at
      ? formatDateTime(row.original.assignment.due_at)
      : m.lms_no_due_date()}
  </span>
)

const ScoreCell = ({ row }: CellProps) => (
  <ScoreText
    score={row.original.assignment.submission?.score}
    points={row.original.assignment.points}
  />
)

function StatusCell({ row }: CellProps) {
  const { now } = useTableState()
  const a = row.original.assignment
  return <SubmissionStatus submission={a.submission} dueAt={a.due_at} now={now} />
}

type SortValue = string | number | null

/** Empty values (no due date, not graded) go last either way. */
function sortBy(value: (row: Row) => SortValue) {
  return (a: { original: Row }, b: { original: Row }) => {
    const x = value(a.original)
    const y = value(b.original)
    if (x === y) return 0
    if (x === null) return 1
    if (y === null) return -1
    if (typeof x === 'number' && typeof y === 'number') return x - y
    return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' })
  }
}

/** The score as a share of the points, so 9 / 10 sorts above 15 / 20. */
function scoreRatio({ assignment: a }: Row): number | null {
  const score = a.submission?.score
  return score == null || !a.points ? null : score / a.points
}

const columns = column.columns([
  column.display({
    id: 'select',
    header: SelectAllHeader,
    cell: SelectCell,
    enableSorting: false,
  }),
  column.accessor((r) => r.assignment.name, {
    id: 'name',
    header: () => m.canvas_tab_column_name(),
    cell: NameCell,
    sortFn: sortBy((r) => r.assignment.name),
  }),
  column.accessor((r) => r.assignment.due_at ?? null, {
    id: 'due',
    header: () => m.canvas_tab_column_due(),
    cell: DueCell,
    sortFn: sortBy((r) => r.assignment.due_at ?? null),
  }),
  column.accessor(scoreRatio, {
    id: 'score',
    header: () => m.canvas_tab_column_score(),
    cell: ScoreCell,
    sortFn: sortBy(scoreRatio),
  }),
  column.display({
    id: 'submission',
    header: () => m.canvas_tab_column_submission(),
    cell: StatusCell,
    enableSorting: false,
  }),
])

/** Fixed widths (with `table-fixed`): opening a description or folding a group doesn't move the
 * columns; the name takes the rest. */
const WIDTHS: Record<string, string> = {
  select: 'w-10',
  due: 'w-48',
  score: 'w-28',
  submission: 'w-40',
}

type Kind = AssignmentImportKind

/**
 * Canvas's assignments, quizzes and grades as one table (M16 §4): by assignment group with the
 * user's score and where each submission stands. Ticked rows are imported into the gradebook
 * (with the score Canvas has) or the tasks through the M08 review; a row opens its details.
 */
export function AssignmentsView({ selected }: { selected?: string }) {
  const { courseId } = useCanvasPage()
  const list = useQuery({
    ...lmsAssignmentListOptions({ path: { course_id: courseId } }),
    placeholderData: keepPreviousData,
  })
  // Without it the table still shows; quizzes then look like plain assignments.
  const quizzes = useQuery({
    ...lmsQuizListOptions({ path: { course_id: courseId } }),
    placeholderData: keepPreviousData,
  }).data?.items
  return (
    <CanvasBoundary
      query={list}
      isEmpty={(data) => data.items.length === 0 && !quizzes?.length}
      empty={
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ClipboardList aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{m.lms_assignments_empty({ provider: m.lms_canvas() })}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      }
    >
      {(data) => (
        <AssignmentTable
          rows={rowsOf(data.items, quizzes ?? [])}
          focused={focusedRow(selected, quizzes)}
        />
      )}
    </CanvasBoundary>
  )
}

/** A quiz link (`quiz:<id>`) opens its assignment's row when it has one. */
function focusedRow(selected: string | undefined, quizzes: readonly Quiz[] | undefined) {
  if (!selected?.startsWith('quiz:')) return selected
  const quiz = quizzes?.find((q) => quizRef(q.external_id) === selected)
  return quiz?.assignment_id ?? selected
}

type Group = { key: string; name: string; weight: number | null; ids: string[] }

/** Assignment groups in Canvas's order, each with its rows' ids. */
function groupsOf(rows: readonly Row[]): Group[] {
  const groups = new Map<string, Group>()
  for (const { id, assignment: a } of rows) {
    const key = a.group_id ?? a.group_name ?? ''
    const group: Group = groups.get(key) ?? {
      key,
      name: a.group_name || m.canvas_tab_group_none(),
      weight: a.group_weight ?? null,
      ids: [],
    }
    group.ids.push(id)
    groups.set(key, group)
  }
  return [...groups.values()]
}

function AssignmentTable({ rows: data, focused }: { rows: Row[]; focused?: string }) {
  const { programId, courseId, go, title } = useCanvasPage()
  const [sorting, setSorting] = useState<SortingState>([])
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [starting, setStarting] = useState<Kind | null>(null)
  const [now] = useState(Date.now)
  const focusedRef = useScrollIntoView<HTMLTableRowElement>(focused)
  const table = useTable({
    features,
    columns,
    data,
    getRowId: (r) => r.id,
    enableRowSelection: (row) => !row.original.practice && !imported(row.original.assignment),
    state: { sorting, rowSelection },
    onSortingChange: (updater) =>
      setSorting(typeof updater === 'function' ? updater(sorting) : updater),
    onRowSelectionChange: (updater) =>
      setRowSelection(typeof updater === 'function' ? updater(rowSelection) : updater),
  })
  // Rows in the table's order (sorted within each group); groups keep Canvas's order.
  const ordered = table.getRowModel().rows
  const groups = groupsOf(data).map((group) => {
    const ids = new Set(group.ids)
    return { ...group, rows: ordered.filter((row) => ids.has(row.id)) }
  })
  const selectable = ordered.filter((row) => row.getCanSelect()).map((row) => row.id)
  // A row imported meanwhile (the list refetches after an import) stays ticked but is left out.
  const picked = selectable.filter((id) => rowSelection[id])
  const state: TableState = {
    now,
    selected: rowSelection,
    selectable,
    setSelected: (ids, on) =>
      setRowSelection((current) => {
        const next = { ...current }
        for (const id of ids) {
          if (on) next[id] = true
          else delete next[id]
        }
        return next
      }),
  }

  const start = (kind: Kind) => {
    setStarting(kind)
    startAssignmentImport(courseId, picked, kind)
      .then((sessionId) => {
        setStarting(null)
        setRowSelection({})
        return reviewAssignmentImport({
          programId,
          sessionId,
          title: () => m.lms_import_assignments_from({ provider: m.lms_canvas() }),
        })
      })
      .catch((error: unknown) => {
        setStarting(null)
        toastError(error)
      })
  }

  const toggleGroup = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <TableContext value={state}>
      <div className="space-y-4">
        <ViewHeader
          title={title}
          primary={
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button disabled={picked.length === 0 || starting !== null} />}
              >
                {starting ? <Spinner /> : <Import aria-hidden />}
                {m.canvas_tab_import()}
                <ChevronDown aria-hidden data-icon="inline-end" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={() => start('assessment')}>
                  <GraduationCap aria-hidden />
                  {m.canvas_tab_import_to_gradebook()}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => start('task')}>
                  <ListChecks aria-hidden />
                  {m.canvas_tab_import_to_tasks()}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
        <div className="overflow-hidden rounded-2xl border border-border">
          <Table className="min-w-xl table-fixed">
            <TableHeader className="bg-muted/50">
              {table.getHeaderGroups().map((group) => (
                <TableRow key={group.id} className="hover:bg-transparent">
                  {group.headers.map((h) => {
                    const sorted = h.column.getIsSorted()
                    return (
                      <TableHead
                        key={h.id}
                        scope="col"
                        aria-sort={
                          sorted === 'asc'
                            ? 'ascending'
                            : sorted === 'desc'
                              ? 'descending'
                              : undefined
                        }
                        className={cn('h-auto py-2 text-muted-foreground', WIDTHS[h.column.id])}
                      >
                        {h.column.getCanSort() ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={h.column.getToggleSortingHandler()}
                            className="-ml-2 h-auto px-2 text-muted-foreground hover:text-foreground"
                          >
                            <table.FlexRender header={h} />
                            {sorted === 'asc' ? (
                              <ArrowUp aria-hidden className="size-3" />
                            ) : sorted === 'desc' ? (
                              <ArrowDown aria-hidden className="size-3" />
                            ) : null}
                          </Button>
                        ) : (
                          <table.FlexRender header={h} />
                        )}
                      </TableHead>
                    )
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {groups.map((group) => {
                const open = !collapsed.has(group.key)
                const ids = group.rows.filter((row) => row.getCanSelect()).map((row) => row.id)
                return (
                  <Fragment key={group.key}>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell className="py-1.5">
                        {ids.length > 0 ? (
                          <SelectMany
                            ids={ids}
                            label={m.canvas_tab_select_group({ name: group.name })}
                          />
                        ) : null}
                      </TableCell>
                      <TableCell colSpan={columns.length - 1} className="py-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-expanded={open}
                          className="-ml-2 h-8 items-center px-1 font-medium aria-expanded:bg-transparent hover:bg-muted"
                          onClick={() => toggleGroup(group.key)}
                        >
                          {open ? (
                            <ChevronDown aria-hidden className="size-4" />
                          ) : (
                            <ChevronRight aria-hidden className="size-4" />
                          )}
                          {group.name}
                          <span className="text-xs font-normal text-muted-foreground">
                            {[
                              m.canvas_tab_group_count({ count: group.rows.length }),
                              group.weight != null
                                ? m.canvas_tab_group_weight({ weight: group.weight })
                                : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </Button>
                      </TableCell>
                    </TableRow>
                    {open
                      ? group.rows.map((row) => {
                          const expanded = focused === row.id
                          const r = row.original
                          return (
                            <Fragment key={row.id}>
                              <TableRow
                                ref={expanded ? focusedRef : undefined}
                                data-state={
                                  rowSelection[row.id] || expanded ? 'selected' : undefined
                                }
                                aria-expanded={expanded}
                                className="cursor-pointer"
                                onClick={() =>
                                  go(
                                    expanded
                                      ? { tab: 'assignments' }
                                      : { tab: 'assignments', ref: row.id },
                                  )
                                }
                              >
                                {row.getAllCells().map((cell) => (
                                  <TableCell
                                    key={cell.id}
                                    className={cn(
                                      'py-2',
                                      cell.column.id === 'name' && 'whitespace-normal',
                                    )}
                                  >
                                    <table.FlexRender cell={cell} />
                                  </TableCell>
                                ))}
                              </TableRow>
                              {expanded ? (
                                <TableRow className="hover:bg-transparent">
                                  <TableCell
                                    colSpan={columns.length}
                                    className="bg-muted/20 whitespace-normal"
                                  >
                                    <div className="py-2 pr-2 pl-10">
                                      <AssignmentDetail
                                        assignment={r.assignment}
                                        quiz={r.quiz}
                                        practice={r.practice}
                                      />
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ) : null}
                            </Fragment>
                          )
                        })
                      : null}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </TableContext>
  )
}
