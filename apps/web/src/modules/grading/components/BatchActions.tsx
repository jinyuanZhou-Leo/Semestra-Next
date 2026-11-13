import type { Assessment, AssessmentCategory } from '@semestra/api-client'
import { gradingAssessmentUpdateManyMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
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
import { invalidateGrading } from '../queries'
import { CategoryBadge } from './CategoryBadge'

/**
 * The gradebook's batch actions for the checked assessments: the same category, weight or dropped
 * state for all of them, or deleting them. The weight and delete dialogs belong to the page, so
 * they can finish closing after the selection is gone.
 */
export function BatchActions({
  courseId,
  selected,
  categories,
  onWeight,
  onDelete,
}: {
  courseId: string
  selected: readonly Assessment[]
  categories: readonly AssessmentCategory[]
  onWeight: () => void
  onDelete: () => void
}) {
  const queryClient = useQueryClient()
  const update = useMutation({
    ...gradingAssessmentUpdateManyMutation(),
    onError: toastError,
    onSuccess: () => invalidateGrading(queryClient),
  })
  const change = (body: { category_id?: string | null; dropped?: boolean }) =>
    update.mutate({
      path: { course_id: courseId },
      body: { assessment_ids: selected.map((a) => a.id), ...body },
    })
  // Dropping is undone from the same button: it counts them in once all are dropped.
  const allDropped = selected.length > 0 && selected.every((a) => a.dropped)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="sm" disabled={update.isPending} />}
        >
          {m.grading_batch_category()}
          <ChevronDown aria-hidden data-icon="inline-end" />
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
      <Button variant="outline" size="sm" disabled={update.isPending} onClick={onWeight}>
        {m.grading_batch_weight()}
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={update.isPending}
        onClick={() => change({ dropped: !allDropped })}
      >
        {allDropped ? m.grading_assessment_include() : m.grading_assessment_drop()}
      </Button>
      <Button variant="destructive" size="sm" disabled={update.isPending} onClick={onDelete}>
        {m.common_delete()}
      </Button>
    </>
  )
}
