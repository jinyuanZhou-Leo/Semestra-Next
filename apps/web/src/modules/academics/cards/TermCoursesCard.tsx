import type { Course } from '@semestra/api-client'
import {
  type CellContext,
  createColumnHelper,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { BookOpen, ChevronDown, Plus, Repeat } from 'lucide-react'
import { createContext, use } from 'react'
import type { CardProps } from '@/app/extensions'
import { useExtensions } from '@/app/registry'
import { HistoryLink } from '@/components/HistoryLink'
import { formatCredits } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { courseColor } from '../color'
import { AddCoursesMenu } from '../components/AddCoursesMenu'
import { coursePath } from '../paths'
import { useColumnData, useCourses } from '../queries'
import { COURSE_COLUMNS, type CourseColumn } from '../types'

const features = tableFeatures({})
const column = createColumnHelper<typeof features, Course>()
type CellProps = CellContext<typeof features, Course>

/** What the module-level cells need; a cell defined in the component would remount every render. */
type CardState = {
  programId: string
  termId: string
  extensions: ReadonlyMap<string, CourseColumn>
  columnData: ReadonlyMap<string, unknown>
}

const CardContext = createContext<CardState | null>(null)

function useCardState(): CardState {
  const state = use(CardContext)
  if (!state) throw new Error('TermCoursesCard cells must render inside TermCoursesCard')
  return state
}

function CodeCell({ row }: CellProps) {
  const { programId, termId } = useCardState()
  const course = row.original
  return (
    <HistoryLink
      href={coursePath(programId, course.id, undefined, termId)}
      className="flex items-center gap-2 font-medium hover:underline"
    >
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: courseColor(course) }}
      />
      {course.code || course.alias || course.title}
      {course.term_ids.length > 1 ? (
        <Repeat
          aria-label={m.academics_course_year_long()}
          className="size-3 text-muted-foreground"
        />
      ) : null}
    </HistoryLink>
  )
}

const TitleCell = ({ row }: CellProps) => (row.original.code ? row.original.title : null)

function ExtensionCell({ row, column: col }: CellProps) {
  const { extensions, columnData } = useCardState()
  const extensionId = col.id.slice('ext:'.length)
  return extensions.get(extensionId)?.cell(row.original, columnData.get(extensionId))
}

const CreditsCell = ({ row }: CellProps) => formatCredits(row.original.credits)

const CELL_CLASS: Record<string, string> = {
  code: 'py-2 pr-3 pl-0',
  title: 'w-full max-w-0 truncate py-2 pr-3 pl-0 text-muted-foreground',
  credits: 'px-0 py-2 text-right text-muted-foreground tabular-nums',
}
const EXTENSION_CELL_CLASS = 'py-2 pr-3 pl-0 whitespace-nowrap'

/** The term's courses with their credits and any extra columns marked `showInTermCard` (M02 §5.4). */
export default function TermCoursesCard({ scope }: CardProps) {
  const termId = scope.kind === 'term' ? scope.termId : undefined
  const programId = scope.programId
  const courses = useCourses(programId, termId).data?.items
  const extra = useExtensions<CourseColumn>(COURSE_COLUMNS).filter((c) => c.showInTermCard)
  const columnData = useColumnData(extra, programId)
  const columns = column.columns([
    column.display({ id: 'code', header: m.academics_course_code(), cell: CodeCell }),
    column.display({ id: 'title', header: m.academics_course_title(), cell: TitleCell }),
    ...extra.map((ext) =>
      column.display({ id: `ext:${ext.id}`, header: ext.header(), cell: ExtensionCell }),
    ),
    column.display({ id: 'credits', header: m.academics_course_credits(), cell: CreditsCell }),
  ])
  const table = useTable({
    features,
    columns,
    data: courses ?? [],
    getRowId: (course) => course.id,
  })
  if (!termId) return null
  const state: CardState = {
    programId,
    termId,
    extensions: new Map(extra.map((ext) => [ext.id, ext])),
    columnData,
  }
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {courses && courses.length === 0 ? (
          <Empty className="border-0 p-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BookOpen aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{m.academics_term_no_courses()}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <CardContext value={state}>
            <Table>
              <TableHeader className="sr-only">
                {table.getHeaderGroups().map((group) => (
                  <TableRow key={group.id}>
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
                      <TableCell
                        key={cell.id}
                        className={CELL_CLASS[cell.column.id] ?? EXTENSION_CELL_CLASS}
                      >
                        <table.FlexRender cell={cell} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContext>
        )}
      </div>
      <div>
        <AddCoursesMenu
          programId={programId}
          termId={termId}
          trigger={
            <Button variant="outline" size="sm">
              <Plus aria-hidden />
              {m.academics_course_add()}
              <ChevronDown aria-hidden data-icon="inline-end" />
            </Button>
          }
        />
      </div>
    </div>
  )
}
