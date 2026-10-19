import type { Quiz } from '@semestra/api-client'
import { lmsQuizzesListOptions } from '@semestra/api-client/react-query'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  type CellContext,
  createColumnHelper,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { ExternalLink, ListChecks } from 'lucide-react'
import { formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { CanvasBoundary } from '../CanvasBoundary'
import { useCanvasPage } from '../context'
import { useScrollIntoView } from './scroll'

const features = tableFeatures({})
const column = createColumnHelper<typeof features, Quiz>()
type CellProps = CellContext<typeof features, Quiz>

const DueCell = ({ row }: CellProps) =>
  row.original.due_at ? formatDateTime(row.original.due_at) : m.lms_no_due_date()
const PointsCell = ({ row }: CellProps) => (
  <span className="tabular-nums">{row.original.points ?? '—'}</span>
)
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
  column.accessor('title', { header: () => m.canvas_tab_column_name() }),
  column.display({ id: 'due', header: () => m.canvas_tab_column_due(), cell: DueCell }),
  column.display({ id: 'points', header: () => m.canvas_tab_column_points(), cell: PointsCell }),
  column.display({
    id: 'questions',
    header: () => m.canvas_tab_column_questions(),
    cell: QuestionsCell,
  }),
  column.display({ id: 'open', header: () => null, cell: OpenCell }),
])

/** Quizzes of the course; they are taken in Canvas (M16 §4). */
export function QuizzesView({ selected }: { selected?: string }) {
  const { courseId, query } = useCanvasPage()
  const list = useQuery({
    ...lmsQuizzesListOptions({ path: { course_id: courseId }, query }),
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
              <ListChecks aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{m.canvas_tab_quizzes_empty()}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      }
    >
      {(data) => <QuizTable items={data.items} selected={selected} />}
    </CanvasBoundary>
  )
}

function QuizTable({ items, selected }: { items: Quiz[]; selected?: string }) {
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
