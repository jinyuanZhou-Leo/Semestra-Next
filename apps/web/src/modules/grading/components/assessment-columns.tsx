import type { Assessment, AssessmentCategory } from '@semestra/api-client'
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
} from '@tanstack/react-table'
import { MoreHorizontal } from 'lucide-react'
import { createContext, useContext } from 'react'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { dueText, percentText } from '../display'
import { scoreText } from '../score'
import { compareValues } from '../sort'
import type { AssessmentAction, AssessmentColumn } from '../types'
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

/** Which rows are checked for a batch action; only rows on screen count. */
export type AssessmentSelection = {
  has: (id: string) => boolean
  /** `'some'` when only part of them are checked. */
  state: (ids: readonly string[]) => boolean | 'some'
  /** Checks them all, or unchecks them all when they already are. */
  toggle: (ids: readonly string[]) => void
  /** The ids of every row on screen: the header checkbox's rows. */
  shown: readonly string[]
}

/**
 * What the cells need from the table. Cells read it from context so the column definitions can
 * live outside the component: a column defined while rendering would be a new component type on
 * every render, and the cell inputs would lose what was being typed.
 */
export type TableActions = {
  programId: string
  /** Columns from other modules by id (`ext:<id>` columns). */
  extensions: ReadonlyMap<string, AssessmentColumn>
  /** Row menu entries from other modules, and how to open one's dialog. */
  actions: readonly AssessmentAction[]
  act: (action: AssessmentAction, a: Assessment) => void
  categories: ReadonlyMap<string, AssessmentCategory>
  whatIf: WhatIf
  /** The forecast's score per ungraded assessment: the hint in an empty assumption. */
  predictions: Record<string, number>
  saveScore: (a: Assessment, text: string) => boolean
  saveWeight: (a: Assessment, text: string) => boolean
  assume: (a: Assessment, text: string) => boolean
  edit: (a: Assessment) => void
  toggleDropped: (a: Assessment) => void
  remove: (a: Assessment) => void
  selection: AssessmentSelection
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
  const { whatIf, predictions, saveScore, assume } = useActions()
  const predicted = predictions[a.id]
  const assumed = whatIf.plan && a.score_percentage === null && !a.dropped
  const assumedValue = whatIf.scores[a.id]
  return (
    <div className="flex items-center justify-end gap-1">
      {assumed ? (
        <InlineInput
          key={`a-${a.id}-${assumedValue ?? ''}`}
          label={`${m.grading_assumed_score()}: ${a.title}`}
          placeholder={predicted === undefined ? '—' : String(Math.round(predicted * 10) / 10)}
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
  const { programId, edit, toggleDropped, remove, actions, act } = useActions()
  const items = (destructive: boolean) =>
    actions
      .filter((action) => Boolean(action.destructive) === destructive)
      .map((action) => (
        <action.Item
          key={action.id}
          assessment={a}
          programId={programId}
          open={() => act(action, a)}
        />
      ))
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={`${m.common_actions()}: ${a.title}`} />
        }
      >
        <MoreHorizontal aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => edit(a)}>{m.grading_assessment_edit()}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => toggleDropped(a)}>
          {a.dropped ? m.grading_assessment_include() : m.grading_assessment_drop()}
        </DropdownMenuItem>
        {items(false)}
        <DropdownMenuSeparator />
        {items(true)}
        <DropdownMenuItem variant="destructive" onClick={() => remove(a)}>
          {m.grading_assessment_delete()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// One component for every contributed column (not a new one per render): it finds the
// contribution by the column's id, so its cells keep their state when the table re-renders.
function ExtensionCell({
  row,
  column: col,
}: {
  row: { original: AssessmentRow }
  column: { id: string }
}) {
  const { extensions, programId } = useActions()
  const Cell = extensions.get(col.id.slice('ext:'.length))?.Cell
  return Cell ? <Cell assessment={row.original} programId={programId} /> : null
}

/** A checkbox for a set of rows: one row, a category's rows, or every row shown. */
export function SelectCheckbox({ ids, label }: { ids: readonly string[]; label: string }) {
  const { selection } = useActions()
  const state = selection.state(ids)
  return (
    <Checkbox
      aria-label={label}
      className="align-middle"
      checked={state === true}
      indeterminate={state === 'some'}
      disabled={ids.length === 0}
      onCheckedChange={() => selection.toggle(ids)}
    />
  )
}

function SelectAll() {
  const { selection } = useActions()
  return <SelectCheckbox ids={selection.shown} label={m.grading_select_all()} />
}

/** The first column, left out in plan mode: rows are checked for batch actions. */
export const selectColumn = column.display({
  id: 'select',
  header: () => <SelectAll />,
  cell: ({ row }) => (
    <SelectCheckbox
      ids={[row.original.id]}
      label={`${m.grading_select()}: ${row.original.title}`}
    />
  ),
  enableSorting: false,
})

/** A contributed column, shown before the row menu. */
export const extensionColumn = (ext: AssessmentColumn) =>
  column.display({
    id: `ext:${ext.id}`,
    header: () => ext.header(),
    cell: ExtensionCell,
    enableSorting: false,
  })

export const actionsColumn = column.display({
  id: 'actions',
  header: () => <span className="sr-only">{m.common_actions()}</span>,
  cell: ({ row }) => <ActionsCell a={row.original} />,
  enableSorting: false,
})

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
    cell: ({ row }) => dueText(row.original),
  }),
  column.accessor((a) => a.weight, {
    id: 'weight',
    header: () => m.grading_assessment_weight(),
    sortFn: by((a) => a.weight),
    cell: ({ row }) => <WeightCell a={row.original} />,
  }),
  column.display({
    id: 'score',
    header: () => <span className="block pr-16 text-right">{m.grading_assessment_score()}</span>,
    cell: ({ row }) => <ScoreCell a={row.original} />,
    enableSorting: false,
  }),
])
