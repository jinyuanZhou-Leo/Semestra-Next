import type { ImportItem, ImportSessionDetail, Issue } from '@semestra/api-client'
import { importsItemDecideManyMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  type CellContext,
  createColumnHelper,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { ChevronDown, ChevronRight, CircleAlert, CircleCheck } from 'lucide-react'
import { createContext, Fragment, type ReactNode, use, useState } from 'react'
import { toastError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useCourses } from '@/modules/academics/queries'
import { m } from '@/paraglide/messages'
import { Checkbox } from '@/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { issueText, itemTitle, itemWhen, itemWeight } from '../labels'
import { storeSession, useItemUpdate } from '../queries'
import { ItemEditor } from './ItemEditor'

const TYPE_ORDER = [
  'course',
  'course_patch',
  'category',
  'assessment',
  'assessment_patch',
  'meeting',
  'event',
  'task',
  'task_patch',
]

/** Items of an open session can be edited; after a commit only the ones that failed. */
export function isEditable(session: ImportSessionDetail, item: ImportItem): boolean {
  if (session.status === 'ready') return true
  return session.status === 'committed' && Boolean(item.result?.error_code)
}

type Column = 'name' | 'when' | 'weight' | 'result'

/** The cell an issue is marked on; the rest go on the name. */
const ISSUE_COLUMN: Record<string, Column> = {
  'import.date_unresolved': 'when',
  'import.term_unresolved': 'when',
  'import.outside_term': 'when',
  'import.no_teaching_weeks': 'when',
  'import.weight_missing': 'weight',
  'import.duplicate_course': 'result',
  'import.duplicate_assessment': 'result',
}

/** The open issues of an accepted item that belong in one cell. */
function issuesIn(item: ImportItem, column: Column): Issue[] {
  if (item.decision !== 'accept') return []
  return item.issues.filter((issue) => (ISSUE_COLUMN[issue.code] ?? 'name') === column)
}

type Group = { key: string; label: string; items: ImportItem[] }

function groupKey(item: ImportItem, targetCourse: string | null | undefined): string {
  if (item.type === 'course') return `item:${item.id}`
  if (item.type === 'course_patch') return `course:${String(item.data.course_id)}`
  const ref = item.data.course_ref
  if (typeof ref === 'string' && ref) return ref
  // Changes to existing assessments and tasks (M09) belong to the session's course.
  return item.type.endsWith('_patch') && targetCourse ? `course:${targetCourse}` : 'none'
}

/** Courses first, each with its categories, assessments, meetings and events (M08 §6.2). */
function groupItems(
  items: readonly ImportItem[],
  courseName: (id: string) => string,
  targetCourse: string | null | undefined,
): Group[] {
  const groups = new Map<string, ImportItem[]>()
  const sorted = items.toSorted(
    (a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.position - b.position,
  )
  for (const item of sorted) {
    const key = groupKey(item, targetCourse)
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  const byId = new Map(items.map((item) => [item.id, item]))
  return [...groups].map(([key, members]) => {
    const [kind, id = ''] = key.split(':')
    const own = kind === 'item' ? byId.get(id) : undefined
    const label =
      key === 'none'
        ? m.imports_group_other()
        : own
          ? itemTitle(own)
          : kind === 'course'
            ? courseName(id)
            : m.imports_group_other()
    return { key, label, items: members }
  })
}

const features = tableFeatures({})
const column = createColumnHelper<typeof features, ImportItem>()
type CellProps = CellContext<typeof features, ImportItem>

/** What the module-level cells read (the React Compiler keeps a cell whose row is unchanged). */
type ReviewState = {
  session: ImportSessionDetail
  expanded: string | null
  busy: boolean
  toggle: (item: ImportItem) => void
  decide: (item: ImportItem, accept: boolean) => void
}
const ReviewContext = createContext<ReviewState | null>(null)

function useReview() {
  const state = use(ReviewContext)
  if (!state) throw new Error('review cells render inside ImportReview')
  return state
}

/** A cell's value, marked when an issue belongs to it: the issue on hover and for screen readers. */
function Marked({ issues, children }: { issues: Issue[]; children: ReactNode }) {
  if (issues.length === 0) return children
  const text = issues.map(issueText).join('; ')
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="inline-flex max-w-full items-center gap-1 text-destructive" />}
      >
        <CircleAlert aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">{children}</span>
        <span className="sr-only">{text}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{text}</TooltipContent>
    </Tooltip>
  )
}

function AcceptCell({ row }: CellProps) {
  const { session, busy, decide } = useReview()
  const item = row.original
  const done = Boolean(item.result && !item.result.error_code)
  return (
    <Checkbox
      aria-label={m.imports_accept_item({ item: itemTitle(item) })}
      checked={item.decision === 'accept'}
      disabled={!isEditable(session, item) || done || busy}
      onCheckedChange={(on) => decide(item, on)}
      onClick={(event) => event.stopPropagation()}
    />
  )
}

function NameCell({ row }: CellProps) {
  const { expanded } = useReview()
  const item = row.original
  const open = expanded === item.id
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {open ? (
        <ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <Marked issues={issuesIn(item, 'name')}>
        <span className="truncate font-medium">{itemTitle(item) || '—'}</span>
      </Marked>
    </span>
  )
}

function WhenCell({ row }: CellProps) {
  const item = row.original
  const issues = issuesIn(item, 'when')
  const when = itemWhen(item)
  return (
    <Marked issues={issues}>{when || (issues.length > 0 ? m.imports_pick_date() : '—')}</Marked>
  )
}

function WeightCell({ row }: CellProps) {
  const { session } = useReview()
  const weight = itemWeight(row.original)
  const text = <span className="tabular-nums">{weight == null ? '—' : `${weight}%`}</span>
  const issues = issuesIn(row.original, 'weight')
  if (issues.length > 0) return <Marked issues={issues}>{text}</Marked>
  // A category whose assessments here add up to something else: often only part of it is
  // imported (M08 §6.2), so this is shown, not an issue.
  const short = session.summary.category_weights?.find(
    (c) => c.item_id === row.original.id && !c.ok,
  )
  if (!short) return text
  const total = m.imports_category_total({ total: short.total })
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="text-warning" />}>
        {text}
        <span className="sr-only">{total}</span>
      </TooltipTrigger>
      <TooltipContent>{total}</TooltipContent>
    </Tooltip>
  )
}

/** Where an item goes once imported; a dated assessment brings its to-do along unsaid. */
function destination(item: ImportItem): string {
  switch (item.type) {
    case 'course':
      return m.imports_dest_course()
    case 'category':
      return m.imports_dest_category()
    case 'assessment':
      return m.imports_dest_gradebook()
    case 'meeting':
      return m.imports_dest_timetable()
    case 'event':
      return m.imports_dest_calendar()
    case 'task':
      return m.imports_dest_tasks()
    default:
      return m.imports_dest_update()
  }
}

function ResultCell({ row }: CellProps) {
  const item = row.original
  const failed = item.result?.error_code
  if (failed) {
    const reason = issueText({ code: failed, params: item.result?.error_params ?? {} })
    return (
      <Marked issues={[{ code: failed, params: item.result?.error_params ?? {} }]}>{reason}</Marked>
    )
  }
  const duplicate = item.issues.filter((i) => ISSUE_COLUMN[i.code] === 'result')
  const exists = duplicate.some((i) => i.code === 'import.duplicate_course')
    ? m.imports_dest_exists_course()
    : m.imports_dest_exists_assessment()
  if (item.decision !== 'accept') {
    // A duplicate starts unticked (M08 §5): why it is skipped, marked once it is ticked. Any
    // other unticked row says nothing; its empty box does.
    return duplicate.length > 0 ? <span className="text-muted-foreground">{exists}</span> : null
  }
  if (duplicate.length > 0) return <Marked issues={duplicate}>{exists}</Marked>
  const done = Boolean(item.result)
  return (
    <span className="flex items-center gap-1 text-muted-foreground">
      {done ? (
        <CircleCheck aria-label={m.imports_row_done()} className="size-4 shrink-0 text-success" />
      ) : null}
      {destination(item)}
    </span>
  )
}

const columns = column.columns([
  column.display({ id: 'accept', header: () => null, cell: AcceptCell }),
  column.display({ id: 'name', header: () => m.imports_column_name(), cell: NameCell }),
  column.display({ id: 'when', header: () => m.imports_column_when(), cell: WhenCell }),
  column.display({ id: 'weight', header: () => m.imports_column_weight(), cell: WeightCell }),
  column.display({ id: 'result', header: () => m.imports_column_result(), cell: ResultCell }),
])

/** Fixed widths (with `table-fixed`): opening an item never moves the columns. */
const WIDTHS: Record<string, string> = {
  accept: 'w-10',
  when: 'w-44',
  weight: 'w-20',
  result: 'w-44',
}

/** "Weights total 100% (incl. 6 already in the gradebook)" on a course's heading. */
function WeightTotal({
  session,
  groupKey: key,
}: {
  session: ImportSessionDetail
  groupKey: string
}) {
  const total = session.summary.weights?.find((w) => w.course_ref === key)
  if (!total) return null
  const className = cn(
    'shrink-0 text-xs font-normal tabular-nums',
    total.ok ? 'text-muted-foreground' : 'text-warning',
  )
  const text = m.imports_weights_total({ total: total.total })
  if (total.existing === 0) return <span className={className}>{text}</span>
  // The gradebook's own assessments count too: said on hover.
  const existing = m.imports_weights_existing({ count: total.existing })
  return (
    <Tooltip>
      <TooltipTrigger render={<span className={className} />}>
        {text}
        <span className="sr-only">{existing}</span>
      </TooltipTrigger>
      <TooltipContent>{existing}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The review of an import session (M08 §6.2): one table, by course, showing for each item where
 * it goes; a problem is marked on the cell it concerns, and an item opens in place to be
 * changed. A course's heading has its weight total, the gradebook's assessments included.
 */
export function ImportReview({
  session,
  className,
}: {
  session: ImportSessionDetail
  className?: string
}) {
  const queryClient = useQueryClient()
  const courses = useCourses(session.program_id).data?.items ?? []
  const courseName = (id: string) => {
    const course = courses.find((c) => c.id === id)
    return course ? (course.code ? `${course.code} · ${course.title}` : course.title) : '…'
  }
  const [expanded, setExpanded] = useState<string | null>(null)
  const update = useItemUpdate({ onError: toastError })
  const bulk = useMutation({
    ...importsItemDecideManyMutation(),
    onError: toastError,
    onSuccess: (result) => storeSession(queryClient, result.session),
  })
  const table = useTable({ features, columns, data: session.items, getRowId: (item) => item.id })
  const rows = new Map(table.getRowModel().rows.map((row) => [row.id, row]))
  const groups = groupItems(session.items, courseName, session.target.course_id)
  const open = session.status === 'ready'
  const busy = update.isPending || bulk.isPending

  const state: ReviewState = {
    session,
    expanded,
    busy,
    toggle: (item) => setExpanded((current) => (current === item.id ? null : item.id)),
    decide: (item, accept) =>
      update.mutate({
        path: { session_id: session.id, item_id: item.id },
        body: { decision: accept ? 'accept' : 'reject' },
      }),
  }
  const decideGroup = (group: Group, accept: boolean) =>
    bulk.mutate({
      path: { session_id: session.id },
      body: { decision: accept ? 'accept' : 'reject', item_ids: group.items.map((i) => i.id) },
    })

  return (
    <ReviewContext value={state}>
      <div className={cn('min-h-0 overflow-y-auto rounded-2xl border border-border', className)}>
        <Table className="table-fixed">
          <TableHeader className="sticky top-0 z-10 bg-muted">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((h) => (
                  <TableHead
                    key={h.id}
                    scope="col"
                    className={cn('h-auto py-2 text-muted-foreground', WIDTHS[h.column.id])}
                  >
                    <table.FlexRender header={h} />
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {groups.map((group) => {
              const accepted = group.items.filter((i) => i.decision === 'accept').length
              return (
                <Fragment key={group.key}>
                  <TableRow className="h-10 bg-muted/40 hover:bg-muted/40">
                    <TableCell className="py-1.5">
                      <Checkbox
                        aria-label={m.imports_group_accept({ group: group.label })}
                        checked={accepted === group.items.length}
                        indeterminate={accepted > 0 && accepted < group.items.length}
                        disabled={!open || busy}
                        onCheckedChange={(on) => decideGroup(group, on)}
                      />
                    </TableCell>
                    <TableCell colSpan={columns.length - 1} className="py-1.5">
                      <span className="flex items-center gap-3">
                        <span className="min-w-0 flex-1 truncate font-medium">{group.label}</span>
                        <WeightTotal session={session} groupKey={group.key} />
                      </span>
                    </TableCell>
                  </TableRow>
                  {group.items.map((item) => {
                    const row = rows.get(item.id)
                    if (!row) return null
                    const isOpen = expanded === item.id
                    return (
                      <Fragment key={item.id}>
                        <TableRow
                          aria-expanded={isOpen}
                          data-state={isOpen ? 'selected' : undefined}
                          className={cn(
                            'h-10 cursor-pointer',
                            item.decision !== 'accept' && 'text-muted-foreground',
                          )}
                          onClick={() => state.toggle(item)}
                        >
                          {row.getAllCells().map((cell) => (
                            <TableCell key={cell.id} className="py-2">
                              <table.FlexRender cell={cell} />
                            </TableCell>
                          ))}
                        </TableRow>
                        {isOpen ? (
                          <TableRow className="hover:bg-transparent">
                            <TableCell
                              colSpan={columns.length}
                              className="bg-muted/20 whitespace-normal"
                            >
                              <div className="py-2 pr-2 pl-10">
                                <ItemEditor
                                  key={item.id}
                                  item={item}
                                  editable={isEditable(session, item)}
                                />
                              </div>
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </Fragment>
                    )
                  })}
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </ReviewContext>
  )
}
