import type { AssignmentOut } from '@semestra/api-client'
import { lmsAssignmentListOptions } from '@semestra/api-client/react-query'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  type CellContext,
  createColumnHelper,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import {
  ChevronDown,
  ChevronRight,
  ClipboardList,
  GraduationCap,
  Import,
  ListChecks,
  ListPlus,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { Spinner } from '@/ui/spinner'
import { Checkbox } from '@/ui/checkbox'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { CanvasBoundary } from '../CanvasBoundary'
import { useCanvasPage } from '../context'
import { AssignmentDetail } from './AssignmentDetail'
import { ScoreText, SubmissionStatus, ViewHeader } from './common'
import { useScrollIntoView } from './scroll'

/** Sample switch (甲/乙), removed once one is picked. */
export const SAMPLE: 'a' | 'b' = (() => {
  try {
    return localStorage.getItem('canvas-sample') === 'b' ? 'b' : 'a'
  } catch {
    return 'a'
  }
})()

/** In 甲 this view imports to the tasks only; in 乙 to either. */
export function importedHere(a: AssignmentOut): boolean {
  return SAMPLE === 'a' ? a.imported_as.some((t) => t.kind === 'task') : a.imported_as.length > 0
}

const features = tableFeatures({})
const column = createColumnHelper<typeof features, AssignmentOut>()
type CellProps = CellContext<typeof features, AssignmentOut>

type TableState = {
  selected: ReadonlySet<string>
  toggle: (id: string, on: boolean) => void
  /** Read once, so "due in 3 days" doesn't change between renders. */
  now: number
}
const TableContext = createContext<TableState | null>(null)

function useTableState() {
  const state = use(TableContext)
  if (!state) throw new Error('assignment cells render inside AssignmentTable')
  return state
}

function SelectCell({ row }: CellProps) {
  const { selected, toggle } = useTableState()
  const a = row.original
  return (
    <Checkbox
      aria-label={m.canvas_tab_select_assignment({ name: a.name })}
      disabled={importedHere(a)}
      // Base UI's checkbox is a span, which the generated `disabled:` styles never match.
      className="data-disabled:cursor-not-allowed data-disabled:opacity-50"
      checked={selected.has(a.external_id)}
      onCheckedChange={(on) => toggle(a.external_id, on)}
      onClick={(event) => event.stopPropagation()}
    />
  )
}

function NameCell({ row }: CellProps) {
  const a = row.original
  const why = a.lock_explanation || m.canvas_tab_item_locked()
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
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
      {a.imported_as.some((t) => t.kind === 'assessment') && SAMPLE === 'b' ? (
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
    {row.original.due_at ? formatDateTime(row.original.due_at) : m.lms_no_due_date()}
  </span>
)

const ScoreCell = ({ row }: CellProps) => (
  <ScoreText score={row.original.submission?.score} points={row.original.points} />
)

function StatusCell({ row }: CellProps) {
  const { now } = useTableState()
  return (
    <SubmissionStatus submission={row.original.submission} dueAt={row.original.due_at} now={now} />
  )
}

const columns = column.columns([
  column.display({ id: 'select', header: () => null, cell: SelectCell }),
  column.display({ id: 'name', header: () => m.canvas_tab_column_name(), cell: NameCell }),
  column.display({ id: 'due', header: () => m.canvas_tab_column_due(), cell: DueCell }),
  column.display({ id: 'score', header: () => m.canvas_tab_column_score(), cell: ScoreCell }),
  column.display({
    id: 'submission',
    header: () => m.canvas_tab_column_submission(),
    cell: StatusCell,
  }),
])

/** Fixed widths (with `table-fixed`): opening a description or folding a group doesn't move the
 * columns; the name takes the rest. */
const WIDTHS: Record<string, string> = {
  select: 'w-10',
  due: 'w-44',
  score: 'w-24',
  submission: 'w-40',
}

type Kind = AssignmentImportKind

/**
 * Assignments by group (M16 §4): tick several and import them into the gradebook or the tasks
 * through the M08 review (`lms.assignment.import`); a row opens its description.
 */
export function AssignmentsView({ selected }: { selected?: string }) {
  const { courseId } = useCanvasPage()
  const list = useQuery({
    ...lmsAssignmentListOptions({ path: { course_id: courseId } }),
    placeholderData: keepPreviousData,
  })
  return (
    <CanvasBoundary
      query={list}
      isEmpty={(data) => data.items.length === 0}
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
      {(data) => <AssignmentTable items={data.items} focused={selected} />}
    </CanvasBoundary>
  )
}

type Group = { key: string; name: string; weight: number | null; rows: string[] }

function groupsOf(items: readonly AssignmentOut[]): Group[] {
  const groups = new Map<string, Group>()
  for (const a of items) {
    const key = a.group_id ?? a.group_name ?? ''
    const group: Group = groups.get(key) ?? {
      key,
      name: a.group_name || m.canvas_tab_group_none(),
      weight: a.group_weight ?? null,
      rows: [],
    }
    group.rows.push(a.external_id)
    groups.set(key, group)
  }
  return [...groups.values()]
}

function AssignmentTable({ items, focused }: { items: AssignmentOut[]; focused?: string }) {
  const { programId, courseId, go, title } = useCanvasPage()
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [starting, setStarting] = useState<Kind | null>(null)
  const [now] = useState(Date.now)
  const focusedRef = useScrollIntoView<HTMLTableRowElement>(focused)
  const table = useTable({ features, columns, data: items, getRowId: (a) => a.external_id })
  const rows = new Map(table.getRowModel().rows.map((row) => [row.id, row]))
  const groups = groupsOf(items)
  const importable = new Set(items.filter((a) => !importedHere(a)).map((a) => a.external_id))
  const picked = [...selected].filter((id) => importable.has(id))

  const state: TableState = {
    now,
    selected,
    toggle: (id, on) =>
      setSelected((current) => {
        const next = new Set(current)
        if (on) next.add(id)
        else next.delete(id)
        return next
      }),
  }

  const start = (kind: Kind) => {
    setStarting(kind)
    startAssignmentImport(courseId, picked, kind)
      .then((sessionId) => {
        setStarting(null)
        setSelected(new Set())
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
            SAMPLE === 'a' ? (
              <Button
                disabled={picked.length === 0 || starting !== null}
                onClick={() => start('task')}
              >
                {starting ? <Spinner /> : <ListPlus aria-hidden />}
                {m.canvas_tab_import_to_tasks()}
              </Button>
            ) : (
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
            )
          }
        />
        <Table className="min-w-xl table-fixed">
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="hover:bg-transparent">
                {group.headers.map((h) => (
                  <TableHead key={h.id} className={WIDTHS[h.column.id]}>
                    <table.FlexRender header={h} />
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {groups.map((group) => {
              const open = !collapsed.has(group.key)
              return (
                <Fragment key={group.key}>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableCell colSpan={columns.length} className="py-1.5">
                      <button
                        type="button"
                        aria-expanded={open}
                        className="flex w-full items-center gap-1.5 text-left font-medium"
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
                      </button>
                    </TableCell>
                  </TableRow>
                  {open
                    ? group.rows.map((id) => {
                        const row = rows.get(id)
                        if (!row) return null
                        const expanded = focused === id
                        const a = row.original
                        return (
                          <Fragment key={id}>
                            <TableRow
                              ref={expanded ? focusedRef : undefined}
                              data-state={expanded ? 'selected' : undefined}
                              aria-expanded={expanded}
                              className="cursor-pointer"
                              onClick={() =>
                                go(
                                  expanded
                                    ? { tab: 'assignments' }
                                    : { tab: 'assignments', ref: id },
                                )
                              }
                            >
                              {row.getAllCells().map((cell) => (
                                <TableCell
                                  key={cell.id}
                                  className={
                                    cell.column.id === 'name' ? 'whitespace-normal' : undefined
                                  }
                                >
                                  <table.FlexRender cell={cell} />
                                </TableCell>
                              ))}
                            </TableRow>
                            {expanded ? (
                              <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={columns.length} className="whitespace-normal">
                                  <div className="py-2 pl-8">
                                    <AssignmentDetail assignment={a} />
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
    </TableContext>
  )
}
