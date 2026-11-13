import type { Assessment, AssessmentCategory, CategorySummary } from '@semestra/api-client'
import {
  gradingAssessmentDeleteMutation,
  gradingAssessmentUpdateMutation,
} from '@semestra/api-client/react-query'
import { type SortingState, useTable } from '@tanstack/react-table'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  SearchX,
} from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import { useExtensions } from '@/app/registry'
import { useUiPref } from '@/app/ui-pref'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useDialogTarget } from '@/lib/dialog-target'
import { toastError } from '@/lib/errors'
import { formatCredits } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { categoryName, percentText } from '../display'
import { Concealed, PercentValue } from './GradeValue'
import { invalidateGrading } from '../queries'
import { parseDecimal, parseScore, scorePatch } from '../score'
import {
  DEFAULT_SORT,
  type SortKey,
  type SortPref,
  groupByCategory,
  groupKey,
  isFolded,
} from '../sort'
import { type AssessmentFilter, matchesFilter } from '../filter'
import {
  ASSESSMENT_ACTIONS,
  ASSESSMENT_COLUMNS,
  type AssessmentAction,
  type AssessmentColumn,
} from '../types'
import type { WhatIf } from '../whatif'
import { AssessmentDialog } from './AssessmentDialog'
import {
  type AssessmentRow,
  type AssessmentSelection,
  SelectCheckbox,
  type TableActions,
  TableActionsContext,
  actionsColumn,
  assessmentColumns,
  extensionColumn,
  features,
  selectColumn,
} from './assessment-columns'
import { CategoryBadge } from './CategoryBadge'
import { GradeTableCard } from './GradeTableCard'

/** Columns of figures: their headings line up with the figures on the right. */
const NUMERIC = new Set(['weight'])

const toSorting = (pref: SortPref): SortingState =>
  pref.key === 'manual' ? [] : [{ id: pref.key, desc: pref.dir === 'desc' }]

function fromSorting(sorting: SortingState): SortPref {
  const first = sorting[0]
  return first ? { key: first.id as SortKey, dir: first.desc ? 'desc' : 'asc' } : DEFAULT_SORT
}

/**
 * The gradebook table (M03 §5.1): scores and weights are typed in the cells (`18/20` is read as
 * points), columns sort, and categories can be shown as collapsible groups. In plan mode the
 * score of an ungraded item takes an assumed value that is never saved as a grade, with the
 * forecast as its hint. `filter` and `search` narrow the rows; the toolbar above holds them.
 * Outside plan mode rows have checkboxes, and the toolbar acts on the checked ones.
 */
export function AssessmentTable({
  programId,
  courseId,
  assessments,
  categories,
  figures,
  whatIf,
  predictions,
  onAssume,
  grouped,
  collapsed,
  onToggleGroup,
  highlighted,
  filter,
  search,
  onClearFilter,
  selection,
  toolbar,
}: {
  programId: string
  courseId: string
  assessments: readonly Assessment[]
  categories: readonly AssessmentCategory[]
  /** The engine's per-category figures from the real (not simulated) summary. */
  figures: readonly CategorySummary[]
  whatIf: WhatIf
  predictions: Record<string, number>
  /** Set (percent) or clear (null) the assumed score of one assessment. */
  onAssume: (assessmentId: string, percent: number | null) => void
  /** Show the categories as collapsible groups. */
  grouped: boolean
  /** The groups (`groupKey`) the user collapsed. */
  collapsed: ReadonlySet<string>
  onToggleGroup: (key: string) => void
  /** The assessment a link points at; its group stays open. */
  highlighted: string | null
  filter: AssessmentFilter
  search: string
  onClearFilter: () => void
  selection: AssessmentSelection
  /** The row above the table: filters and actions. */
  toolbar: ReactNode
}) {
  const queryClient = useQueryClient()
  const [sort, setSort] = useUiPref<SortPref>('grading.sort', DEFAULT_SORT)
  const editing = useDialogTarget<Assessment>()
  const deleting = useDialogTarget<Assessment>()
  const acting = useDialogTarget<{ action: string; assessment: Assessment }>()
  const actions = useExtensions<AssessmentAction>(ASSESSMENT_ACTIONS)

  const update = useMutation({
    ...gradingAssessmentUpdateMutation(),
    onError: toastError,
    onSuccess: () => invalidateGrading(queryClient),
  })
  const remove = useMutation({
    ...gradingAssessmentDeleteMutation(),
    onError: toastError,
    onSuccess: async () => {
      deleting.close()
      await invalidateGrading(queryClient)
    },
  })

  const byId = new Map(categories.map((c) => [c.id, c]))

  const saveScore = (a: Assessment, text: string): boolean => {
    const patch = scorePatch(parseScore(text))
    if (!patch) return false
    update.mutate({ path: { assessment_id: a.id }, body: patch })
    return true
  }
  const saveWeight = (a: Assessment, text: string): boolean => {
    const weight = text.trim() === '' ? 0 : parseDecimal(text)
    if (weight === null || weight > 100) return false
    update.mutate({ path: { assessment_id: a.id }, body: { weight } })
    return true
  }
  const assume = (a: Assessment, text: string): boolean => {
    const parsed = parseScore(text)
    if (parsed.kind === 'invalid') return false
    if (parsed.kind === 'clear') onAssume(a.id, null)
    else if (parsed.kind === 'percentage') onAssume(a.id, parsed.value)
    else onAssume(a.id, (parsed.earned / parsed.possible) * 100)
    return true
  }

  const rank = new Map(categories.map((c) => [c.id, c.position]))
  const data: AssessmentRow[] = assessments
    .filter((a) => matchesFilter(a, filter, search))
    .toSorted((a, b) => a.position - b.position)
    .map((a) => ({ ...a, categoryRank: a.category_id ? (rank.get(a.category_id) ?? null) : null }))
  const contributed = useExtensions<AssessmentColumn>(ASSESSMENT_COLUMNS)
  const columns = [
    ...(whatIf.plan ? [] : [selectColumn]),
    ...assessmentColumns,
    ...contributed.map(extensionColumn),
    actionsColumn,
  ]
  const actionsValue: TableActions = {
    programId,
    extensions: new Map(contributed.map((ext) => [ext.id, ext])),
    actions,
    act: (action, assessment) => acting.show({ action: action.id, assessment }),
    categories: byId,
    whatIf,
    predictions,
    saveScore,
    saveWeight,
    assume,
    edit: editing.show,
    toggleDropped: (a) =>
      update.mutate({ path: { assessment_id: a.id }, body: { dropped: !a.dropped } }),
    remove: deleting.show,
    selection,
  }

  const table = useTable({
    features,
    columns,
    data,
    getRowId: (a) => a.id,
    state: { sorting: toSorting(sort) },
    onSortingChange: (updater) =>
      setSort(fromSorting(typeof updater === 'function' ? updater(toSorting(sort)) : updater)),
  })

  const rows = table.getRowModel().rows
  const groups = grouped
    ? groupByCategory(rows, categories, (r) => r.original.category_id)
    : [{ category: null as AssessmentCategory | null, items: rows }]
  const columnCount = columns.length

  return (
    <TableActionsContext value={actionsValue}>
      <>
        <GradeTableCard planning={whatIf.plan} toolbar={toolbar}>
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((group) => (
                <TableRow key={group.id} className="hover:bg-transparent">
                  {group.headers.map((h) => {
                    const sorted = h.column.getIsSorted()
                    return (
                      <TableHead
                        key={h.id}
                        scope="col"
                        className="h-10 text-xs text-muted-foreground"
                        aria-sort={
                          sorted === 'asc'
                            ? 'ascending'
                            : sorted === 'desc'
                              ? 'descending'
                              : undefined
                        }
                      >
                        {h.column.getCanSort() ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className={cn(
                              'h-8 px-2 font-normal text-muted-foreground',
                              // A number column's heading ends where its figures end.
                              NUMERIC.has(h.column.id)
                                ? 'float-right -mr-0.5 flex-row-reverse'
                                : '-ml-2',
                            )}
                            onClick={h.column.getToggleSortingHandler()}
                          >
                            <table.FlexRender header={h} />
                            {sorted === 'asc' ? (
                              <ArrowUp aria-hidden className="size-3" />
                            ) : sorted === 'desc' ? (
                              <ArrowDown aria-hidden className="size-3" />
                            ) : (
                              <ArrowUpDown aria-hidden className="size-3 opacity-50" />
                            )}
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
              {assessments.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={columnCount} className="whitespace-normal">
                    <Empty className="border-0 p-0">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <ClipboardList aria-hidden />
                        </EmptyMedia>
                        <EmptyTitle>{m.grading_assessments_empty()}</EmptyTitle>
                      </EmptyHeader>
                    </Empty>
                  </TableCell>
                </TableRow>
              ) : data.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={columnCount} className="whitespace-normal">
                    <Empty className="border-0 p-0">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <SearchX aria-hidden />
                        </EmptyMedia>
                        <EmptyTitle>{m.grading_assessments_filtered_empty()}</EmptyTitle>
                      </EmptyHeader>
                      <EmptyContent>
                        <Button variant="link" size="sm" onClick={onClearFilter}>
                          {m.common_clear_filters()}
                        </Button>
                      </EmptyContent>
                    </Empty>
                  </TableCell>
                </TableRow>
              ) : null}
              {groups.map((group) => {
                const groupId = groupKey(group.category)
                const ids = group.items.map((row) => row.id)
                const isCollapsed = grouped && isFolded(group.category, ids, collapsed, highlighted)
                return (
                  <Fragment key={groupId}>
                    {grouped ? (
                      <GroupRow
                        category={group.category}
                        count={group.items.length}
                        ids={ids}
                        selectable={!whatIf.plan}
                        figures={figures.find(
                          (f) => f.category_id === (group.category?.id ?? null),
                        )}
                        collapsed={isCollapsed}
                        planning={whatIf.plan}
                        trailing={contributed.length + 1}
                        onToggle={() => onToggleGroup(groupId)}
                      />
                    ) : null}
                    {isCollapsed
                      ? null
                      : group.items.map((row) => (
                          <TableRow
                            key={row.id}
                            data-assessment={row.id}
                            data-highlighted={row.id === highlighted ? true : undefined}
                            data-state={selection.has(row.id) ? 'selected' : undefined}
                            className={cn(
                              'transition-colors duration-700 data-highlighted:bg-primary/10',
                              row.original.dropped &&
                                'text-muted-foreground line-through decoration-1',
                            )}
                          >
                            {row.getAllCells().map((cell) => (
                              <TableCell key={cell.id} className="py-1.5">
                                <table.FlexRender cell={cell} />
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        </GradeTableCard>

        <AssessmentDialog
          courseId={courseId}
          categories={categories}
          assessment={editing.target ?? undefined}
          {...editing.props}
        />
        {actions.map((action) => {
          const mine = acting.target?.action === action.id
          return (
            <action.Dialog
              key={action.id}
              {...acting.props}
              open={acting.open && mine}
              assessment={mine ? (acting.target?.assessment ?? null) : null}
              programId={programId}
              close={acting.close}
            />
          )
        })}
        <ConfirmDialog
          {...deleting.props}
          title={m.grading_assessment_delete()}
          description={m.grading_assessment_delete_confirm({ title: deleting.target?.title ?? '' })}
          confirmLabel={m.grading_assessment_delete()}
          pending={remove.isPending}
          onConfirm={() =>
            deleting.target && remove.mutate({ path: { assessment_id: deleting.target.id } })
          }
        />
      </>
    </TableActionsContext>
  )
}

/** A category's heading row in grouped view: its weight and the average of its real scores. */
function GroupRow({
  category,
  ids,
  selectable,
  count,
  figures,
  collapsed,
  planning,
  trailing,
  onToggle,
}: {
  category: AssessmentCategory | null
  /** The group's rows on screen, checked together from the group's checkbox. */
  ids: readonly string[]
  /** Outside plan mode the first column holds checkboxes. */
  selectable: boolean
  count: number
  /** Missing when none of the group's items count (all dropped). */
  figures: CategorySummary | undefined
  collapsed: boolean
  /** In plan mode the rows show assumptions; the group's average stays the real one. */
  planning: boolean
  /** The columns after the score: contributed ones and the row menu. */
  trailing: number
  onToggle: () => void
}) {
  const graded = figures?.graded_weight ?? 0
  const weight = figures?.weight ?? 0
  const average = figures?.average ?? null
  return (
    <TableRow className="bg-muted/40 hover:bg-muted/40">
      {selectable ? (
        <TableCell className="py-1.5">
          {/* A collapsed group's rows are off screen, so they cannot be checked. */}
          {collapsed ? null : (
            <SelectCheckbox
              ids={ids}
              label={`${m.grading_select()}: ${category ? categoryName(category) : m.grading_category_none()}`}
            />
          )}
        </TableCell>
      ) : null}
      <TableCell colSpan={3} className="py-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 items-center px-1 font-medium aria-expanded:bg-transparent hover:bg-muted"
          aria-expanded={!collapsed}
          onClick={onToggle}
        >
          {collapsed ? (
            <ChevronRight aria-hidden className="size-4" />
          ) : (
            <ChevronDown aria-hidden className="size-4" />
          )}
          <CategoryBadge category={category} />
          <span className="text-xs font-normal text-muted-foreground tabular-nums">
            {m.grading_group_summary({
              count,
              graded: formatCredits(graded),
            })}
          </span>
        </Button>
      </TableCell>
      <TableCell className="py-1.5">
        <span className="block pr-3 text-right font-medium tabular-nums">
          {formatCredits(weight)}
        </span>
      </TableCell>
      <TableCell className="py-1.5">
        {planning ? (
          <span className="block pr-16 text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums">
            <Concealed>{m.grading_actual({ value: percentText(average) })}</Concealed>
          </span>
        ) : (
          <span className="block pr-16 text-right font-medium tabular-nums">
            <span className="sr-only">{m.grading_average()}: </span>
            <PercentValue value={average} />
          </span>
        )}
      </TableCell>
      <TableCell colSpan={trailing} className="py-1.5" />
    </TableRow>
  )
}
