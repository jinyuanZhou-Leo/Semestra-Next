import type { CourseResult } from '@semestra/api-client'
import { gradingCourseResultUpdateMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Calculator, Flag, ListTree, MoreHorizontal, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
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
import { ImportMenu } from './ImportMenu'
import { OfficialGradeDialog } from './OfficialGradeDialog'

/**
 * The row above the gradebook table. In plan mode the whole row is replaced by what plan mode
 * needs, the way a table's selection actions replace its filters; its height never changes.
 */
export function GradebookToolbar({
  programId,
  result,
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
      <div className="flex h-8 items-center gap-2">
        <Badge variant="secondary" className="bg-primary/10 text-primary">
          {m.grading_planning()}
        </Badge>
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {m.grading_plan_hint()}
        </p>
        <Button
          variant="destructive"
          size="sm"
          disabled={!hasAssumptions}
          onClick={onClearAssumptions}
        >
          {m.grading_plan_clear()}
        </Button>
        <Button variant="destructive" size="sm" onClick={() => onPlanningChange(false)}>
          <X aria-hidden />
          {m.grading_plan_exit()}
        </Button>
      </div>
    )
  }
  const plan = (
    <Button variant="outline" size="sm" disabled={!canPlan} onClick={() => onPlanningChange(true)}>
      <Calculator aria-hidden />
      {m.grading_plan()}
    </Button>
  )
  return (
    <div className="flex h-8 items-center justify-end gap-2">
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
              <DropdownMenuItem
                variant="destructive"
                onClick={() =>
                  update.mutate({
                    path: { course_id: result.course_id },
                    body: { final_override_percentage: null },
                  })
                }
              >
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
