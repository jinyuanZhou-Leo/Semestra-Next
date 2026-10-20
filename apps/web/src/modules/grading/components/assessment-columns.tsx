import type { Assessment, AssessmentCategory } from '@semestra/api-client'
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
} from '@tanstack/react-table'
import { MoreHorizontal } from 'lucide-react'
import { createContext, useContext } from 'react'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { dueText, percentText } from '../display'
import { scoreText } from '../score'
import { compareValues } from '../sort'
import type { WhatIf } from '../whatif'
import { CategoryBadge } from './CategoryBadge'
import { InlineInput } from './InlineInput'

/** A table row: the assessment and where its category sorts. */
export type AssessmentRow = Assessment & { categoryRank: number | null }

export const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
})
const column = createColumnHelper<typeof features, AssessmentRow>()

/**
 * What the cells need from the table. Cells read it from context so the column definitions can
 * live outside the component: a column defined while rendering would be a new component type on
 * every render, and the cell inputs would lose what was being typed.
 */
export type TableActions = {
  categories: ReadonlyMap<string, AssessmentCategory>
  whatIf: WhatIf
  saveScore: (a: Assessment, text: string) => boolean
  saveWeight: (a: Assessment, text: string) => boolean
  assume: (a: Assessment, text: string) => boolean
  edit: (a: Assessment) => void
  toggleDropped: (a: Assessment) => void
  remove: (a: Assessment) => void
}

export const TableActionsContext = createContext<TableActions | null>(null)

function useActions(): TableActions {
  const actions = useContext(TableActionsContext)
  if (!actions) throw new Error('AssessmentTable cells render inside AssessmentTable')
  return actions
}

type Sortable = { original: AssessmentRow }
const by = (value: (a: AssessmentRow) => number | string | null) => (a: Sortable, b: Sortable) =>
  compareValues(value(a.original), value(b.original))

function CategoryCell({ a }: { a: Assessment }) {
  const { categories } = useActions()
  return <CategoryBadge category={a.category_id ? categories.get(a.category_id) : null} />
}

function WeightCell({ a }: { a: Assessment }) {
  const { saveWeight } = useActions()
  return (
    <div className="flex justify-end">
      <InlineInput
        key={`w-${a.id}-${a.weight}`}
        label={`${m.grading_assessment_weight()}: ${a.title}`}
        value={String(a.weight)}
        onCommit={(text) => saveWeight(a, text)}
        className="w-16"
      />
    </div>
  )
}

function ScoreCell({ a }: { a: Assessment }) {
  const { whatIf, saveScore, assume } = useActions()
  const assumed = whatIf.plan && a.score_percentage === null && !a.dropped
  const assumedValue = whatIf.scores[a.id]
  return (
    <div className="flex items-center justify-end gap-1">
      {assumed ? (
        <InlineInput
          key={`a-${a.id}-${assumedValue ?? ''}`}
          label={`${m.grading_assumed_score()}: ${a.title}`}
          placeholder="—"
          tone="assumed"
          value={assumedValue === undefined ? '' : String(Math.round(assumedValue * 100) / 100)}
          onCommit={(text) => assume(a, text)}
        />
      ) : (
        <InlineInput
          key={`s-${a.id}-${scoreText(a)}`}
          label={`${m.grading_assessment_score()}: ${a.title}`}
          placeholder="—"
          value={scoreText(a)}
          onCommit={(text) => saveScore(a, text)}
        />
      )}
      {/* Every row keeps this slot so scores line up whether typed as points or percent. */}
      <span className="w-12 text-left text-xs text-muted-foreground tabular-nums">
        {a.points_earned !== null && a.score_percentage !== null
          ? percentText(a.score_percentage)
          : null}
      </span>
    </div>
  )
}

function ActionsCell({ a }: { a: Assessment }) {
  const { edit, toggleDropped, remove } = useActions()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`${m.grading_actions()}: ${a.title}`}
          />
        }
      >
        <MoreHorizontal aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => edit(a)}>{m.grading_assessment_edit()}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => toggleDropped(a)}>
          {a.dropped ? m.grading_assessment_include() : m.grading_assessment_drop()}
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={() => remove(a)}>
          {m.grading_assessment_delete()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export const assessmentColumns = column.columns([
  column.accessor((a) => a.title, {
    id: 'title',
    header: () => m.grading_assessment_title(),
    sortFn: by((a) => a.title),
    cell: ({ row }) => (
      <span className="block max-w-64 truncate font-medium">{row.original.title}</span>
    ),
  }),
  column.accessor((a) => a.category_id ?? '', {
    id: 'category',
    header: () => m.grading_assessment_category(),
    sortFn: by((a) => a.categoryRank),
    cell: ({ row }) => <CategoryCell a={row.original} />,
  }),
  column.accessor((a) => a.due_at ?? '', {
    id: 'due',
    header: () => m.grading_assessment_due(),
    sortFn: by((a) => (a.due_at === null ? null : Date.parse(a.due_at))),
    cell: ({ row }) => (
      <span className={cn(row.original.status === 'overdue' && 'text-destructive')}>
        {dueText(row.original)}
        {row.original.status === 'overdue' ? (
          <span className="ml-1.5 text-xs">{m.grading_overdue()}</span>
        ) : null}
      </span>
    ),
  }),
  column.accessor((a) => a.weight, {
    id: 'weight',
    header: () => <span className="block text-right">{m.grading_assessment_weight()}</span>,
    sortFn: by((a) => a.weight),
    cell: ({ row }) => <WeightCell a={row.original} />,
  }),
  column.display({
    id: 'score',
    header: () => <span className="block pr-16 text-right">{m.grading_assessment_score()}</span>,
    cell: ({ row }) => <ScoreCell a={row.original} />,
    enableSorting: false,
  }),
  column.display({
    id: 'actions',
    header: () => <span className="sr-only">{m.grading_actions()}</span>,
    cell: ({ row }) => <ActionsCell a={row.original} />,
    enableSorting: false,
  }),
])
