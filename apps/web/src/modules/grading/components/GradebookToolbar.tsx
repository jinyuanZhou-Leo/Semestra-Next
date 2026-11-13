import type { Assessment, AssessmentCategory, CourseResult } from '@semestra/api-client'
import { gradingCourseResultUpdateMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Calculator, Flag, MoreHorizontal, Search, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { SEGMENT, SEGMENTED } from '@/lib/segmented'
import { SelectionToolbar } from '@/components/SelectionToolbar'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/ui/input-group'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { type AssessmentFilter, FILTERS, filterLabel } from '../filter'
import { invalidateGrading } from '../queries'
import { AddMenu } from './AddMenu'
import { PlanBar } from './GradeTableCard'
import { OfficialGradeDialog } from './OfficialGradeDialog'
import { BatchActions } from './BatchActions'

/**
 * The header bar of the gradebook table; in plan mode it is the `PlanBar`, and while assessments
 * are checked the batch actions take the filters' place (`SelectionToolbar`).
 */
export function GradebookToolbar({
  programId,
  result,
  filter,
  onFilterChange,
  search,
  onSearchChange,
  planning,
  canPlan,
  hasAssumptions,
  onPlanningChange,
  onClearAssumptions,
  grouped,
  onGroupedChange,
  onAdd,
  categories,
  selected,
  onBatchWeight,
  onBatchDelete,
  onClearSelection,
  batchOpen,
}: {
  programId: string
  result: CourseResult
  filter: AssessmentFilter
  onFilterChange: (filter: AssessmentFilter) => void
  search: string
  onSearchChange: (search: string) => void
  planning: boolean
  /** Plan mode needs weights that add up to 100%. */
  canPlan: boolean
  hasAssumptions: boolean
  onPlanningChange: (planning: boolean) => void
  onClearAssumptions: () => void
  grouped: boolean
  onGroupedChange: (grouped: boolean) => void
  onAdd: () => void
  categories: readonly AssessmentCategory[]
  /** The checked assessments on screen. */
  selected: readonly Assessment[]
  onBatchWeight: () => void
  onBatchDelete: () => void
  onClearSelection: () => void
  /** A batch dialog is open: Esc is its, not the selection's. */
  batchOpen: boolean
}) {
  if (planning) {
    return (
      <PlanBar
        hint={m.grading_plan_hint()}
        hasAssumptions={hasAssumptions}
        onClearAssumptions={onClearAssumptions}
        onExit={() => onPlanningChange(false)}
      />
    )
  }
  const plan = (
    <Button
      variant="secondary"
      size="sm"
      disabled={!canPlan}
      onClick={() => onPlanningChange(true)}
    >
      <Calculator aria-hidden />
      {m.grading_plan()}
    </Button>
  )
  return (
    <div className="flex h-8 items-center gap-2">
      <SelectionToolbar
        className="mr-auto"
        count={selected.length}
        countLabel={m.common_selected_count({ count: selected.length })}
        label={m.grading_batch_actions()}
        onClear={onClearSelection}
        paused={batchOpen}
        actions={
          <BatchActions
            courseId={result.course_id}
            selected={selected}
            categories={categories}
            onWeight={onBatchWeight}
            onDelete={onBatchDelete}
          />
        }
      >
        <ToggleGroup
          aria-label={m.grading_filter()}
          size="sm"
          className={SEGMENTED}
          value={[filter]}
          onValueChange={([next]) => next && onFilterChange(next as AssessmentFilter)}
        >
          {FILTERS.map((f) => (
            <ToggleGroupItem key={f} value={f} className={SEGMENT}>
              {filterLabel(f)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <InputGroup className="h-8 w-56">
          <InputGroupInput
            aria-label={m.grading_search_assessments()}
            placeholder={m.grading_search_assessments()}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
          <InputGroupAddon>
            <Search aria-hidden />
          </InputGroupAddon>
        </InputGroup>
      </SelectionToolbar>
      {canPlan ? (
        plan
      ) : (
        <Tooltip>
          {/* A disabled button gets no pointer events; the wrapper shows why it is off. */}
          <TooltipTrigger render={<span className="inline-flex" />}>{plan}</TooltipTrigger>
          <TooltipContent>{m.grading_plan_needs_weights()}</TooltipContent>
        </Tooltip>
      )}
      <AddMenu programId={programId} courseId={result.course_id} onAdd={onAdd} />
      <MoreMenu result={result} grouped={grouped} onGroupedChange={onGroupedChange} />
    </div>
  )
}

/** The table's view option and less frequent course actions: the official grade. */
function MoreMenu({
  result,
  grouped,
  onGroupedChange,
}: {
  result: CourseResult
  grouped: boolean
  onGroupedChange: (grouped: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [official, setOfficial] = useState(false)
  const update = useMutation({
    ...gradingCourseResultUpdateMutation(),
    onError: toastError,
    onSuccess: () => invalidateGrading(queryClient),
  })
  const hasOfficial = result.final_override_percentage !== null
  const setOfficialValue = (value: number | null) =>
    update.mutateAsync({
      path: { course_id: result.course_id },
      body: { final_override_percentage: value },
    })
  const removeOfficial = () => {
    const before = result.final_override_percentage
    void setOfficialValue(null).then(
      () =>
        toast(m.grading_official_removed(), {
          action: { label: m.common_undo(), onClick: () => void setOfficialValue(before) },
        }),
      () => undefined,
    )
  }
  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="icon-sm" aria-label={m.common_more_actions()} />
                }
              />
            }
          >
            <MoreHorizontal aria-hidden />
          </TooltipTrigger>
          <TooltipContent>{m.common_more_actions()}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuGroup>
            <DropdownMenuCheckboxItem checked={grouped} onCheckedChange={onGroupedChange}>
              {m.grading_group_by_category()}
            </DropdownMenuCheckboxItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setOfficial(true)}>
            <Flag aria-hidden />
            {hasOfficial ? m.grading_official_edit() : m.grading_official_set()}
          </DropdownMenuItem>
          {hasOfficial ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={removeOfficial}>
                <X aria-hidden />
                {m.grading_official_remove()}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <OfficialGradeDialog result={result} open={official} onOpenChange={setOfficial} />
    </>
  )
}
