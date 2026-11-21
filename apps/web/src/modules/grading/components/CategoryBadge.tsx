import type { AssessmentCategory } from '@semestra/api-client'
import { cn } from '@/lib/utils'
import { categoryColor, categoryName } from '../display'

/**
 * A category's color dot and name. The name wraps so a picker can show it in full; `truncate` cuts
 * it to one line (full name in the native `title`) where space is short, such as a table cell.
 */
export function CategoryBadge({
  category,
  truncate = false,
}: {
  category: AssessmentCategory | null | undefined
  truncate?: boolean
}) {
  if (!category) return <span className="text-muted-foreground">—</span>
  const name = categoryName(category)
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1.5">
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: categoryColor(category.color) }}
      />
      <span
        className={cn('min-w-0', truncate ? 'truncate' : 'break-words')}
        title={truncate ? name : undefined}
      >
        {name}
      </span>
    </span>
  )
}
