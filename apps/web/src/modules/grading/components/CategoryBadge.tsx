import type { AssessmentCategory } from '@semestra/api-client'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { categoryColor, categoryName } from '../display'

export function CategoryBadge({ category }: { category: AssessmentCategory | null | undefined }) {
  if (!category) return <span className="text-muted-foreground">—</span>
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1.5">
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: categoryColor(category.color) }}
      />
      <Tooltip>
        <TooltipTrigger render={<span className="min-w-0 truncate" />}>
          {categoryName(category)}
        </TooltipTrigger>
        <TooltipContent>{categoryName(category)}</TooltipContent>
      </Tooltip>
    </span>
  )
}
