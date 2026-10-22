import { type AssignmentOut, lmsAssignmentImport } from '@semestra/api-client'
import { lmsAssignmentListOptions } from '@semestra/api-client/react-query'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type CellContext,
  createColumnHelper,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { ChevronDown, ChevronRight, ClipboardList } from 'lucide-react'
import { createContext, Fragment, use, useState } from 'react'
import { AiAction } from '@/components/AiAction'
import { toastError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { openImport } from '@/modules/imports/launcher'
import { invalidateLms } from '@/modules/lms/queries'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Checkbox } from '@/ui/checkbox'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { CanvasBoundary } from '../CanvasBoundary'
import { useCanvasPage } from '../context'
import { AssignmentDetail } from './AssignmentDetail'
import { useScrollIntoView } from './scroll'

const features = tableFeatures({})
const column = createColumnHelper<typeof features, AssignmentOut>()
type CellProps = CellContext<typeof features, AssignmentOut>

type TableState = {
  selected: ReadonlySet<string>
  toggle: (id: string, on: boolean) => void
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
      disabled={a.imported_as.length > 0}
      checked={selected.has(a.external_id)}
      onCheckedChange={(on) => toggle(a.external_id, on)}
      onClick={(event) => event.stopPropagation()}
    />
  )
}

const NameCell = ({ row }: CellProps) => <span className="font-medium">{row.original.name}</span>

const DueCell = ({ row }: CellProps) => (
  <span className="whitespace-nowrap">
    {row.original.due_at ? formatDateTime(row.original.due_at) : m.lms_no_due_date()}
  </span>
)

const PointsCell = ({ row }: CellProps) => (
  <span className="tabular-nums">{row.original.points ?? '—'}</span>
)

function submissionLabel(a: AssignmentOut): string {
  const s = a.submission
  if (!s) return '—'
  if (s.missing) return m.canvas_tab_submission_missing()
  if (s.state === 'graded') return m.canvas_tab_submission_graded()
  if (s.submitted_at || s.state === 'submitted' || s.state === 'pending_review') {
    return s.late ? m.canvas_tab_submission_late() : m.canvas_tab_submission_submitted()
  }
  return m.canvas_tab_submission_unsubmitted()
}

const SubmissionCell = ({ row }: CellProps) => (
  <span className="whitespace-nowrap">{submissionLabel(row.original)}</span>
)

const ImportedCell = ({ row }: CellProps) =>
  row.original.imported_as.length > 0 ? <Badge variant="secondary">{m.lms_imported()}</Badge> : null

const columns = column.columns([
  column.display({ id: 'select', header: () => null, cell: SelectCell }),
  column.display({ id: 'name', header: () => m.canvas_tab_column_name(), cell: NameCell }),
  column.display({ id: 'due', header: () => m.canvas_tab_column_due(), cell: DueCell }),
  column.display({ id: 'points', header: () => m.canvas_tab_column_points(), cell: PointsCell }),
  column.display({
    id: 'submission',
    header: () => m.canvas_tab_column_submission(),
    cell: SubmissionCell,
  }),
  column.display({
    id: 'imported',
    header: () => m.canvas_tab_column_imported(),
    cell: ImportedCell,
  }),
])

type Kind = 'assessment' | 'task'

/**
 * Assignments by group (M16 §4): tick several and import them into the gradebook or the tasks
 * through the M08 review (`lms.assignment.import`); a row opens its description.
 */
export function AssignmentsView({ selected }: { selected?: string }) {
  const { courseId, query } = useCanvasPage()
  const list = useQuery({
    ...lmsAssignmentListOptions({ path: { course_id: courseId }, query }),
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
    const group = groups.get(key) ?? {
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
  const { programId, courseId, go } = useCanvasPage()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [starting, setStarting] = useState<Kind | null>(null)
  const focusedRef = useScrollIntoView<HTMLTableRowElement>(focused)
  const table = useTable({ features, columns, data: items, getRowId: (a) => a.external_id })
  const rows = new Map(table.getRowModel().rows.map((row) => [row.id, row]))
  const groups = groupsOf(items)
  const importable = new Set(
    items.filter((a) => a.imported_as.length === 0).map((a) => a.external_id),
  )
  const picked = [...selected].filter((id) => importable.has(id))

  const state: TableState = {
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
    lmsAssignmentImport({
      path: { course_id: courseId },
      body: { external_ids: picked, as_kind: kind },
      throwOnError: true,
    })
      .then(({ data }) => {
        setStarting(null)
        setSelected(new Set())
        return openImport({
          programId,
          mode: 'direct',
          source: 'session',
          sessionId: data.session_id,
          title: () => m.lms_import_assignments_from({ provider: m.lms_canvas() }),
        })
      })
      .then(() => invalidateLms(queryClient))
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
      <div className="space-y-3">
        {/* Always shown, so ticking a row never moves the table. */}
        <div className="flex min-h-9 flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {picked.length > 0
              ? m.canvas_tab_selected_count({ count: picked.length })
              : m.canvas_tab_select_hint()}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <AiAction
              state={starting === 'assessment' ? 'running' : 'idle'}
              label={m.canvas_tab_import_to_gradebook()}
              disabled={picked.length === 0 || starting !== null}
              className="h-8 w-48 text-sm"
              onClick={() => start('assessment')}
            />
            <AiAction
              state={starting === 'task' ? 'running' : 'idle'}
              label={m.canvas_tab_import_to_tasks()}
              disabled={picked.length === 0 || starting !== null}
              className="h-8 w-40 text-sm"
              onClick={() => start('task')}
            />
          </div>
        </div>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="hover:bg-transparent">
                {group.headers.map((h) => (
                  <TableHead key={h.id} className={h.column.id === 'select' ? 'w-8' : undefined}>
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
                                <TableCell key={cell.id}>
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
