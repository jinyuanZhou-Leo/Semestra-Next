import type { AssignmentOut, GradeItem } from '@semestra/api-client'
import { lmsAssignmentListOptions, lmsGradeListOptions } from '@semestra/api-client/react-query'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  type CellContext,
  createColumnHelper,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { Calculator, GraduationCap, Import } from 'lucide-react'
import { createContext, Fragment, use, useState } from 'react'
import { HistoryLink } from '@/components/HistoryLink'
import { formatDate, formatPercent } from '@/lib/format'
import { coursePath } from '@/modules/academics/paths'
import { m } from '@/paraglide/messages'
import { toastError } from '@/lib/errors'
import { reviewAssignmentImport, startAssignmentImport } from '@/modules/lms/import/assignments'
import { Badge } from '@/ui/badge'
import { Checkbox } from '@/ui/checkbox'
import { Spinner } from '@/ui/spinner'
import { Button } from '@/ui/button'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { CanvasBoundary } from '../CanvasBoundary'
import { useCanvasPage } from '../context'
import { SAMPLE } from './AssignmentsView'
import { IconAction, ScoreText, SubmissionStatus, ViewHeader } from './common'

const features = tableFeatures({})
const column = createColumnHelper<typeof features, GradeItem>()
type CellProps = CellContext<typeof features, GradeItem>

type GradesState = {
  assignments: ReadonlyMap<string, AssignmentOut>
  now: number
  selected: ReadonlySet<string>
  toggle: (id: string, on: boolean) => void
}
const GradesContext = createContext<GradesState>({
  assignments: new Map(),
  now: 0,
  selected: new Set(),
  toggle: () => {},
})

const inGradebook = (a: AssignmentOut | undefined) =>
  Boolean(a?.imported_as.some((t) => t.kind === 'assessment'))

function SelectCell({ row }: CellProps) {
  const { assignments, selected, toggle } = use(GradesContext)
  const g = row.original
  const a = assignments.get(g.external_id)
  return (
    <Checkbox
      aria-label={m.canvas_tab_select_assignment({ name: g.name })}
      disabled={!a || inGradebook(a)}
      className="data-disabled:cursor-not-allowed data-disabled:opacity-50"
      checked={selected.has(g.external_id)}
      onCheckedChange={(on) => toggle(g.external_id, on)}
    />
  )
}

function NameCell({ row }: CellProps) {
  const { assignments } = use(GradesContext)
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span className="font-medium">{row.original.name}</span>
      {inGradebook(assignments.get(row.original.external_id)) ? (
        <Badge variant="secondary">{m.canvas_tab_in_gradebook()}</Badge>
      ) : null}
    </span>
  )
}

function ScoreCell({ row }: CellProps) {
  const g = row.original
  const letter = g.grade && g.grade !== String(g.score) ? g.grade : null
  return (
    <span className="flex items-center gap-1.5">
      <ScoreText score={g.score} points={g.points_possible} />
      {letter ? <span className="text-muted-foreground">{letter}</span> : null}
    </span>
  )
}

function StatusCell({ row }: CellProps) {
  const { assignments, now } = use(GradesContext)
  const a = assignments.get(row.original.external_id)
  return a ? <SubmissionStatus submission={a.submission} dueAt={a.due_at} now={now} /> : null
}

const GradedCell = ({ row }: CellProps) => (
  <span className="whitespace-nowrap text-muted-foreground">
    {row.original.graded_at ? formatDate(row.original.graded_at) : null}
  </span>
)

const columns = column.columns([
  ...(SAMPLE === 'a'
    ? [column.display({ id: 'select', header: () => null, cell: SelectCell })]
    : []),
  column.display({ id: 'name', header: () => m.canvas_tab_column_name(), cell: NameCell }),
  column.display({ id: 'score', header: () => m.canvas_tab_column_score(), cell: ScoreCell }),
  column.display({
    id: 'submission',
    header: () => m.canvas_tab_column_submission(),
    cell: StatusCell,
  }),
  column.display({ id: 'graded', header: () => m.canvas_tab_column_graded(), cell: GradedCell }),
])

/**
 * Canvas's own grades, as the platform reports them (M16 §4). The card on top points to the
 * gradebook, where GPA, targets and "what do I need" are worked out.
 */
export function GradesView() {
  const { programId, courseId, title } = useCanvasPage()
  const list = useQuery({
    ...lmsGradeListOptions({ path: { course_id: courseId } }),
    placeholderData: keepPreviousData,
  })
  // Groups' weights and the submission states; without them the scores still show.
  const assignments = useQuery({
    ...lmsAssignmentListOptions({ path: { course_id: courseId } }),
    placeholderData: keepPreviousData,
  }).data?.items
  const [now] = useState(Date.now)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [starting, setStarting] = useState(false)
  const byId = new Map(assignments?.map((a) => [a.external_id, a]))
  const picked = [...selected].filter((id) => byId.has(id) && !inGradebook(byId.get(id)))
  const state: GradesState = {
    assignments: byId,
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
  const start = () => {
    setStarting(true)
    startAssignmentImport(courseId, picked, 'assessment')
      .then((sessionId) => {
        setStarting(false)
        setSelected(new Set())
        return reviewAssignmentImport({
          programId,
          sessionId,
          title: () => m.lms_import_assignments_from({ provider: m.lms_canvas() }),
        })
      })
      .catch((error: unknown) => {
        setStarting(false)
        toastError(error)
      })
  }
  return (
    <div className="flex flex-1 flex-col gap-4">
      <ViewHeader
        title={title}
        tools={
          <IconAction
            label={m.canvas_tab_grades_cta_open()}
            nativeButton={false}
            render={<HistoryLink href={coursePath(programId, courseId, 'grades')} />}
          >
            <Calculator aria-hidden />
          </IconAction>
        }
        primary={
          SAMPLE === 'a' ? (
            <Button disabled={picked.length === 0 || starting} onClick={start}>
              {starting ? <Spinner /> : <Import aria-hidden />}
              {m.canvas_tab_import_to_gradebook()}
            </Button>
          ) : null
        }
      />
      <CanvasBoundary
        query={list}
        isEmpty={(data) => data.items.length === 0}
        empty={
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <GraduationCap aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{m.canvas_tab_grades_empty()}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        }
      >
        {(data) => (
          <GradesContext value={state}>
            <div className="space-y-4">
              <Total items={data.items} />
              <GradeTable items={data.items.filter((g) => g.kind !== 'total')} />
            </div>
          </GradesContext>
        )}
      </CanvasBoundary>
    </div>
  )
}

/** Canvas's current grade for the course: "84.6% · A-". */
function Total({ items }: { items: GradeItem[] }) {
  const total = items.find((g) => g.kind === 'total')
  if (!total || (total.score == null && !total.grade)) return null
  return (
    <div className="flex items-baseline gap-3 rounded-2xl border px-4 py-3">
      <span className="text-sm text-muted-foreground">{m.canvas_tab_grades_current()}</span>
      {total.score != null ? (
        <span className="font-heading text-2xl font-semibold tabular-nums">
          {formatPercent(total.score / 100)}
        </span>
      ) : null}
      {total.grade ? <span className="text-lg font-medium">{total.grade}</span> : null}
    </div>
  )
}

type Group = { key: string; name: string; weight: number | null; rows: GradeItem[] }

/** Rows by assignment group, in the order Canvas lists them, with the group's weight. */
function groupsOf(items: readonly GradeItem[], assignments: GradesState['assignments']): Group[] {
  const groups = new Map<string, Group>()
  for (const g of items) {
    const key = g.group_name ?? ''
    const group: Group = groups.get(key) ?? {
      key,
      name: g.group_name || m.canvas_tab_group_none(),
      weight: assignments.get(g.external_id)?.group_weight ?? null,
      rows: [],
    }
    group.rows.push(g)
    groups.set(key, group)
  }
  return [...groups.values()]
}

function GradeTable({ items }: { items: GradeItem[] }) {
  const { assignments } = use(GradesContext)
  const table = useTable({
    features,
    columns,
    data: items,
    getRowId: (g) => `${g.kind}:${g.external_id}`,
  })
  const rows = new Map(table.getRowModel().rows.map((row) => [row.original, row]))
  const groups = groupsOf(items, assignments)
  if (items.length === 0) return null
  return (
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id} className="hover:bg-transparent">
            {group.headers.map((h) => (
              <TableHead key={h.id} className={h.column.id === 'select' ? 'w-10' : undefined}>
                <table.FlexRender header={h} />
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {groups.map((group) => (
          <Fragment key={group.key}>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableCell colSpan={columns.length} className="py-1.5 font-medium">
                {group.name}
                {group.weight != null ? (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    {m.canvas_tab_group_weight({ weight: group.weight })}
                  </span>
                ) : null}
              </TableCell>
            </TableRow>
            {group.rows.map((g) => {
              const row = rows.get(g)
              if (!row) return null
              return (
                <TableRow key={row.id}>
                  {row.getAllCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cell.column.id === 'name' ? 'whitespace-normal' : undefined}
                    >
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              )
            })}
          </Fragment>
        ))}
      </TableBody>
    </Table>
  )
}
