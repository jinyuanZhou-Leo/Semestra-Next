import type { Quiz, Submission } from '@semestra/api-client'
import { lmsAssignmentListOptions, lmsQuizListOptions } from '@semestra/api-client/react-query'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  type CellContext,
  createColumnHelper,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { ExternalLink, ListChecks, Lock } from 'lucide-react'
import { formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { CanvasBoundary } from '../CanvasBoundary'
import { useCanvasPage } from '../context'
import { attemptsLabel } from './common'
import { useScrollIntoView } from './scroll'

/** A quiz with the user's submission of its assignment (graded quizzes have one). */
type Row = Quiz & { mine?: Submission | null }

const features = tableFeatures({})
const column = createColumnHelper<typeof features, Row>()
type CellProps = CellContext<typeof features, Row>

function TitleCell({ row }: CellProps) {
  const q = row.original
  const why = q.lock_explanation || m.canvas_tab_item_locked()
  return (
    <span className="flex items-center gap-1.5">
      <span className="font-medium">{q.title}</span>
      {q.locked ? (
        <Tooltip>
          <TooltipTrigger
            className="inline-flex rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            aria-label={why}
          >
            <Lock aria-hidden className="size-3.5 text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{why}</TooltipContent>
        </Tooltip>
      ) : null}
    </span>
  )
}
const DueCell = ({ row }: CellProps) =>
  row.original.due_at ? formatDateTime(row.original.due_at) : m.lms_no_due_date()
const TimeCell = ({ row }: CellProps) =>
  row.original.time_limit
    ? m.canvas_tab_minutes({ count: row.original.time_limit })
    : m.canvas_tab_no_time_limit()
const AttemptsCell = ({ row }: CellProps) => {
  const used = row.original.mine?.attempt
  const allowed = attemptsLabel(row.original.allowed_attempts)
  return (
    <span className="whitespace-nowrap">
      {used ? m.canvas_tab_attempts_used({ used, allowed }) : allowed}
    </span>
  )
}
function ScoreCell({ row }: CellProps) {
  const score = row.original.mine?.score
  const points = row.original.points
  return (
    <span className="tabular-nums">
      {score == null ? (points ?? '—') : points == null ? score : `${score} / ${points}`}
    </span>
  )
}
const QuestionsCell = ({ row }: CellProps) => (
  <span className="tabular-nums">{row.original.question_count ?? '—'}</span>
)
function OpenCell({ row }: CellProps) {
  const url = row.original.web_url
  if (!url) return null
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={m.canvas_tab_open_item_in_canvas({ name: row.original.title })}
      // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the children label it
      render={<a href={url} target="_blank" rel="noopener noreferrer" />}
      nativeButton={false}
    >
      <ExternalLink aria-hidden />
    </Button>
  )
}

const columns = column.columns([
  column.display({ id: 'title', header: () => m.canvas_tab_column_name(), cell: TitleCell }),
  column.display({ id: 'due', header: () => m.canvas_tab_column_due(), cell: DueCell }),
  column.display({ id: 'time', header: () => m.canvas_tab_column_time_limit(), cell: TimeCell }),
  column.display({
    id: 'attempts',
    header: () => m.canvas_tab_column_attempts(),
    cell: AttemptsCell,
  }),
  column.display({ id: 'score', header: () => m.canvas_tab_column_score(), cell: ScoreCell }),
  column.display({
    id: 'questions',
    header: () => m.canvas_tab_column_questions(),
    cell: QuestionsCell,
  }),
  column.display({ id: 'open', header: () => null, cell: OpenCell }),
])

/**
 * Quizzes of the course with their time limit, attempts and the user's score; they are taken in
 * Canvas (M16 §4). The score comes from the quiz's assignment, read with the assignments.
 */
export function QuizzesView({ selected }: { selected?: string }) {
  const { courseId } = useCanvasPage()
  const list = useQuery({
    ...lmsQuizListOptions({ path: { course_id: courseId } }),
    placeholderData: keepPreviousData,
  })
  // Without it the table still shows; only "my score" and attempts used stay empty.
  const assignments = useQuery({
    ...lmsAssignmentListOptions({ path: { course_id: courseId } }),
    placeholderData: keepPreviousData,
  }).data
  const mine = new Map(assignments?.items.map((a) => [a.external_id, a.submission]))
  return (
    <CanvasBoundary
      query={list}
      isEmpty={(data) => data.items.length === 0}
      empty={
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ListChecks aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{m.canvas_tab_quizzes_empty()}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      }
    >
      {(data) => (
        <QuizTable
          items={data.items.map((q) => ({
            ...q,
            mine: q.assignment_id ? mine.get(q.assignment_id) : null,
          }))}
          selected={selected}
        />
      )}
    </CanvasBoundary>
  )
}

function QuizTable({ items, selected }: { items: Row[]; selected?: string }) {
  const table = useTable({ features, columns, data: items, getRowId: (q) => q.external_id })
  const selectedRef = useScrollIntoView<HTMLTableRowElement>(selected)
  return (
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id} className="hover:bg-transparent">
            {group.headers.map((h) => (
              <TableHead key={h.id}>
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
            ref={row.id === selected ? selectedRef : undefined}
            data-state={row.id === selected ? 'selected' : undefined}
          >
            {row.getAllCells().map((cell) => (
              <TableCell key={cell.id}>
                <table.FlexRender cell={cell} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
