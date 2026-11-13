import type { Assessment, AssessmentCategory } from '@semestra/api-client'
import { gradingAssessmentUpdateManyMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Eye, EyeOff, Percent, Trash2, X } from 'lucide-react'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { invalidateGrading } from '../queries'
import { CategoryBadge } from './CategoryBadge'

/**
 * Takes the filters' place in the gradebook toolbar while assessments are checked: the same
 * category, weight or dropped state for all of them, or deleting them. The weight and delete
 * dialogs belong to the page, so they can finish closing after the selection is gone.
 */
export function SelectionBar({
  courseId,
  selected,
  categories,
  onWeight,
  onDelete,
  onClear,
}: {
  courseId: string
  selected: readonly Assessment[]
  categories: readonly AssessmentCategory[]
  onWeight: () => void
  onDelete: () => void
  onClear: () => void
}) {
  const queryClient = useQueryClient()
  const ids = selected.map((a) => a.id)
  const update = useMutation({
    ...gradingAssessmentUpdateManyMutation(),
    onError: toastError,
    onSuccess: () => invalidateGrading(queryClient),
  })
  const change = (body: { category_id?: string | null; dropped?: boolean }) =>
    update.mutate({ path: { course_id: courseId }, body: { assessment_ids: ids, ...body } })
  // Dropping is undone from the same button: it counts them in once all are dropped.
  const allDropped = selected.every((a) => a.dropped)

  return (
    <div className="mr-auto flex h-8 animate-in items-center gap-1 rounded-full bg-muted pr-1 pl-4 text-sm duration-150 fade-in-0">
      <span className="mr-1 font-medium whitespace-nowrap tabular-nums">
        {m.common_selected_count({ count: selected.length })}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
          {m.grading_batch_category()}
          <ChevronDown aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          {categories.map((category) => (
            <DropdownMenuItem
              key={category.id}
              onClick={() => change({ category_id: category.id })}
            >
              <CategoryBadge category={category} />
            </DropdownMenuItem>
          ))}
          {categories.length > 0 ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem onClick={() => change({ category_id: null })}>
            {m.grading_category_none()}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="ghost" size="sm" onClick={onWeight}>
        <Percent aria-hidden />
        {m.grading_batch_weight()}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => change({ dropped: !allDropped })}>
        {allDropped ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
        {allDropped ? m.grading_assessment_include() : m.grading_assessment_drop()}
      </Button>
      <Button variant="destructive" size="sm" onClick={onDelete}>
        <Trash2 aria-hidden />
        {m.common_delete()}
      </Button>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={m.common_clear_selection()}
              onClick={onClear}
            />
          }
        >
          <X aria-hidden />
        </TooltipTrigger>
        <TooltipContent>{m.common_clear_selection()}</TooltipContent>
      </Tooltip>
    </div>
  )
}
