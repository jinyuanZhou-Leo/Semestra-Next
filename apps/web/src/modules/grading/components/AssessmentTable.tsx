import type { Assessment, AssessmentCategory } from '@semestra/api-client'
import {
  gradingAssessmentCreateMutation,
  gradingAssessmentDeleteMutation,
  gradingAssessmentUpdateMutation,
} from '@semestra/api-client/react-query'
import { type SortingState, useTable } from '@tanstack/react-table'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, ClipboardList, Plus } from 'lucide-react'
import { Fragment, useState } from 'react'
import { useUiPref } from '@/app/ui-pref'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toastError } from '@/lib/errors'
import { formatCredits } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Input } from '@/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { percentText } from '../display'
import { invalidateGrading } from '../queries'
import { parseScore, scorePatch } from '../score'
import { DEFAULT_SORT, type SortKey, type SortPref, groupByCategory } from '../sort'
import type { WhatIf } from '../whatif'
import { AssessmentDialog } from './AssessmentDialog'
import {
  type AssessmentRow,
  type TableActions,
  TableActionsContext,
  assessmentColumns,
  features,
} from './assessment-columns'
import { CategoryBadge } from './CategoryBadge'

const toSorting = (pref: SortPref): SortingState =>
  pref.key === 'manual' ? [] : [{ id: pref.key, desc: pref.dir === 'desc' }]

function fromSorting(sorting: SortingState): SortPref {
  const first = sorting[0]
  return first ? { key: first.id as SortKey, dir: first.desc ? 'desc' : 'asc' } : DEFAULT_SORT
}

/** Weight of the items that count, and the weighted average of their real scores. */
function groupFigures(items: readonly Assessment[]) {
  const counted = items.filter((a) => !a.dropped)
  const graded = counted.filter((a) => a.score_percentage !== null)
  const gradedWeight = graded.reduce((sum, a) => sum + a.weight, 0)
  return {
    weight: counted.reduce((sum, a) => sum + a.weight, 0),
    graded: gradedWeight,
    average:
      gradedWeight === 0
        ? null
        : graded.reduce((sum, a) => sum + a.weight * (a.score_percentage ?? 0), 0) / gradedWeight,
  }
}

/**
 * The gradebook table (M03 §5.1): scores and weights are typed in the cells (`18/20` is read as
 * points), columns sort, and categories can be shown as collapsible groups. In plan mode the
 * score of an ungraded item takes an assumed value that is never saved as a grade. The last row
 * adds an assessment by its title.
 */
export function AssessmentTable({
  courseId,
  assessments,
  categories,
  whatIf,
  onAssume,
  grouped,
}: {
  courseId: string
  assessments: readonly Assessment[]
  categories: readonly AssessmentCategory[]
  whatIf: WhatIf
  /** Set (percent) or clear (null) the assumed score of one assessment. */
  onAssume: (assessmentId: string, percent: number | null) => void
  /** Show the categories as collapsible groups. */
  grouped: boolean
}) {
  const queryClient = useQueryClient()
  const [sort, setSort] = useUiPref<SortPref>('grading.sort', DEFAULT_SORT)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [editing, setEditing] = useState<Assessment | null>(null)
  const [deleting, setDeleting] = useState<Assessment | null>(null)
  const [quickTitle, setQuickTitle] = useState('')

  const update = useMutation({
    ...gradingAssessmentUpdateMutation(),
    onError: toastError,
    onSuccess: () => invalidateGrading(queryClient),
  })
  const create = useMutation({
    ...gradingAssessmentCreateMutation(),
    onError: toastError,
    onSuccess: async () => {
      setQuickTitle('')
      await invalidateGrading(queryClient)
    },
  })
  const remove = useMutation({
    ...gradingAssessmentDeleteMutation(),
    onError: toastError,
    onSuccess: async () => {
      setDeleting(null)
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
    const weight = text.trim() === '' ? 0 : Number(text.replace(',', '.'))
    if (!(weight >= 0 && weight <= 100)) return false
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
    .toSorted((a, b) => a.position - b.position)
    .map((a) => ({ ...a, categoryRank: a.category_id ? (rank.get(a.category_id) ?? null) : null }))
  const actionsValue: TableActions = {
    categories: byId,
    whatIf,
    saveScore,
    saveWeight,
    assume,
    edit: setEditing,
    toggleDropped: (a) =>
      update.mutate({ path: { assessment_id: a.id }, body: { dropped: !a.dropped } }),
    remove: setDeleting,
  }

  const table = useTable({
    features,
    columns: assessmentColumns,
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
  const columnCount = assessmentColumns.length

  const addQuick = () => {
    const title = quickTitle.trim()
    if (title === '' || create.isPending) return
    create.mutate({ path: { course_id: courseId }, body: { title } })
  }
  const toggleGroup = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  return (
    <TableActionsContext value={actionsValue}>
      <>
        <div
          className={cn(
            'rounded-2xl border border-border transition-colors',
            whatIf.plan && 'border-primary/30',
          )}
        >
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
                            className="-ml-2 h-8 px-2 font-normal text-muted-foreground"
                            onClick={h.column.getToggleSortingHandler()}
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
              ) : null}
              {groups.map((group) => {
                const groupId = group.category?.id ?? '__none__'
                const isCollapsed = grouped && collapsed.has(groupId)
                return (
                  <Fragment key={groupId}>
                    {grouped ? (
                      <GroupRow
                        category={group.category}
                        items={group.items.map((r) => r.original)}
                        collapsed={isCollapsed}
                        onToggle={() => toggleGroup(groupId)}
                      />
                    ) : null}
                    {isCollapsed
                      ? null
                      : group.items.map((row) => (
                          <TableRow
                            key={row.id}
                            data-assessment={row.id}
                            className={cn(
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
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columnCount} className="py-1.5">
                  <form
                    className="flex items-center gap-1 text-muted-foreground"
                    onSubmit={(event) => {
                      event.preventDefault()
                      addQuick()
                    }}
                  >
                    <Plus aria-hidden className="size-4 shrink-0" />
                    <Input
                      aria-label={m.grading_quick_add()}
                      placeholder={m.grading_quick_add()}
                      value={quickTitle}
                      onChange={(event) => setQuickTitle(event.target.value)}
                      className="h-8 border-transparent bg-transparent px-2 shadow-none focus-visible:bg-input/50"
                    />
                  </form>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <AssessmentDialog
          courseId={courseId}
          categories={categories}
          assessment={editing ?? undefined}
          open={editing !== null}
          onOpenChange={(open) => !open && setEditing(null)}
        />
        <ConfirmDialog
          open={deleting !== null}
          onOpenChange={(open) => !open && setDeleting(null)}
          title={m.grading_assessment_delete()}
          description={m.grading_assessment_delete_confirm({ title: deleting?.title ?? '' })}
          confirmLabel={m.grading_assessment_delete()}
          pending={remove.isPending}
          onConfirm={() => deleting && remove.mutate({ path: { assessment_id: deleting.id } })}
        />
      </>
    </TableActionsContext>
  )
}

/** A category's heading row in grouped view: its weight and the average of its real scores. */
function GroupRow({
  category,
  items,
  collapsed,
  onToggle,
}: {
  category: AssessmentCategory | null
  items: readonly Assessment[]
  collapsed: boolean
  onToggle: () => void
}) {
  const figures = groupFigures(items)
  return (
    <TableRow className="bg-muted/40 hover:bg-muted/40">
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
              count: items.length,
              graded: formatCredits(figures.graded),
              weight: formatCredits(figures.weight),
            })}
          </span>
        </Button>
      </TableCell>
      <TableCell className="py-1.5">
        <span className="block pr-3 text-right font-medium tabular-nums">
          {formatCredits(figures.weight)}
        </span>
      </TableCell>
      <TableCell className="py-1.5">
        <span className="block pr-3 text-right font-medium tabular-nums">
          <span className="sr-only">{m.grading_average()}: </span>
          {percentText(figures.average)}
        </span>
      </TableCell>
      <TableCell className="py-1.5" />
    </TableRow>
  )
}
