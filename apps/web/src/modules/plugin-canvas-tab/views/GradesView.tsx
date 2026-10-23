import type { GradeItem } from '@semestra/api-client'
import { lmsGradeListOptions } from '@semestra/api-client/react-query'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  type CellContext,
  createColumnHelper,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { Calculator, GraduationCap } from 'lucide-react'
import { HistoryLink } from '@/components/HistoryLink'
import { formatCredits, formatDate } from '@/lib/format'
import { coursePath } from '@/modules/academics/paths'
import { m } from '@/paraglide/messages'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { CanvasBoundary } from '../CanvasBoundary'
import { useCanvasPage } from '../context'

const features = tableFeatures({})
const column = createColumnHelper<typeof features, GradeItem>()
type CellProps = CellContext<typeof features, GradeItem>

function NameCell({ row }: CellProps) {
  const g = row.original
  return (
    <span className={g.kind === 'total' ? 'font-medium' : undefined}>
      {g.kind === 'total' ? m.canvas_tab_grades_total() : g.name}
      {g.group_name && g.kind !== 'total' ? (
        <span className="ml-1.5 text-xs text-muted-foreground">{g.group_name}</span>
      ) : null}
    </span>
  )
}

function ScoreCell({ row }: CellProps) {
  const g = row.original
  const score =
    g.score != null && g.points_possible != null
      ? `${formatCredits(g.score)} / ${formatCredits(g.points_possible)}`
      : g.score != null
        ? formatCredits(g.score)
        : null
  return (
    <span className="tabular-nums whitespace-nowrap">
      {[score, g.grade && g.grade !== String(g.score) ? g.grade : null]
        .filter(Boolean)
        .join(' · ') || '—'}
    </span>
  )
}

const GradedCell = ({ row }: CellProps) =>
  row.original.graded_at ? formatDate(row.original.graded_at) : '—'

const columns = column.columns([
  column.display({ id: 'name', header: () => m.canvas_tab_column_name(), cell: NameCell }),
  column.display({ id: 'score', header: () => m.canvas_tab_column_score(), cell: ScoreCell }),
  column.display({ id: 'graded', header: () => m.canvas_tab_column_graded(), cell: GradedCell }),
])

/**
 * Canvas's own grades, as the platform reports them (M16 §4). The card on top points to the
 * gradebook, where GPA, targets and "what do I need" are worked out.
 */
export function GradesView() {
  const { programId, courseId } = useCanvasPage()
  const list = useQuery({
    ...lmsGradeListOptions({ path: { course_id: courseId } }),
    placeholderData: keepPreviousData,
  })
  return (
    <div className="space-y-4">
      <Alert>
        <Calculator aria-hidden />
        <AlertTitle>{m.canvas_tab_grades_cta_title()}</AlertTitle>
        <AlertDescription>{m.canvas_tab_grades_cta_description()}</AlertDescription>
        <AlertAction>
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<HistoryLink href={coursePath(programId, courseId, 'grades')} />}
          >
            {m.canvas_tab_grades_cta_open()}
          </Button>
        </AlertAction>
      </Alert>
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
        {(data) => <GradeTable items={data.items} />}
      </CanvasBoundary>
    </div>
  )
}

function GradeTable({ items }: { items: GradeItem[] }) {
  const table = useTable({
    features,
    columns,
    data: items.toSorted((a, b) => Number(b.kind === 'total') - Number(a.kind === 'total')),
    getRowId: (g) => `${g.kind}:${g.external_id}`,
  })
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
          <TableRow key={row.id}>
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
