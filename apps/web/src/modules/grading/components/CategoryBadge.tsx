import type { AssessmentCategory } from '@semestra/api-client'
import { categoryColor, categoryName } from '../display'

export function CategoryBadge({ category }: { category: AssessmentCategory | null | undefined }) {
  if (!category) return <span className="text-muted-foreground">—</span>
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: categoryColor(category.color) }}
      />
      {categoryName(category)}
    </span>
  )
}
