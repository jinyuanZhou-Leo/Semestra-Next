import type { CourseResult } from '@semestra/api-client'
import { gradingCourseResultUpdateMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Calculator, Flag, ListTree, MoreHorizontal, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { Toggle } from '@/ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { invalidateGrading } from '../queries'
import { PlanBar } from './GradeTableCard'
import { ImportMenu } from './ImportMenu'
import { OfficialGradeDialog } from './OfficialGradeDialog'

/** The header bar of the gradebook table; in plan mode it is the `PlanBar`. */
export function GradebookToolbar({
  programId,
  result,
  count,
  planning,
  canPlan,
  hasAssumptions,
  onPlanningChange,
  onClearAssumptions,
  grouped,
  onGroupedChange,
  onAdd,
}: {
  programId: string
  result: CourseResult
  /** How many assessments the table lists. */
  count: number
  planning: boolean
  /** Plan mode needs weights that add up to 100%. */
  canPlan: boolean
  hasAssumptions: boolean
  onPlanningChange: (planning: boolean) => void
  onClearAssumptions: () => void
  grouped: boolean
  onGroupedChange: (grouped: boolean) => void
  onAdd: () => void
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
    <Button variant="outline" size="sm" disabled={!canPlan} onClick={() => onPlanningChange(true)}>
      <Calculator aria-hidden />
      {m.grading_plan()}
    </Button>
  )
  return (
    <div className="flex h-8 items-center gap-2">
      <h2 className="flex-1 truncate text-sm font-medium">
        {m.grading_assessments_heading()}{' '}
        <span className="font-normal text-muted-foreground tabular-nums">{count}</span>
      </h2>
      {canPlan ? (
        plan
      ) : (
        <Tooltip>
          {/* A disabled button gets no pointer events; the wrapper shows why it is off. */}
          <TooltipTrigger render={<span className="inline-flex" />}>{plan}</TooltipTrigger>
          <TooltipContent>{m.grading_plan_needs_weights()}</TooltipContent>
        </Tooltip>
      )}
      <Toggle variant="outline" size="sm" pressed={grouped} onPressedChange={onGroupedChange}>
        <ListTree aria-hidden />
        {m.grading_group_by_category()}
      </Toggle>
      <ImportMenu programId={programId} courseId={result.course_id} />
      <Button size="sm" onClick={onAdd}>
        <Plus aria-hidden />
        {m.grading_assessment_add()}
      </Button>
      <MoreMenu result={result} />
    </div>
  )
}

/** Less frequent course actions: the official grade. */
function MoreMenu({ result }: { result: CourseResult }) {
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
                  <Button variant="outline" size="icon-sm" aria-label={m.common_more_actions()} />
                }
              />
            }
          >
            <MoreHorizontal aria-hidden />
          </TooltipTrigger>
          <TooltipContent>{m.common_more_actions()}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-52">
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
