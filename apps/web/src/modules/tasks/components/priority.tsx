import type { Task } from '@semestra/api-client'
import { Flag } from 'lucide-react'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { type ShownPriority, shownPriority } from '../types'

/**
 * Flag color of each level; rows show no flag for none (M05 §5.1). None of them follows the
 * accent color, so the levels stay apart under any accent and apart from the star (primary).
 * The menus draw none as an outline flag, so low (filled gray) still differs from it.
 */
export const PRIORITY_COLORS: Record<ShownPriority, string> = {
  none: 'text-muted-foreground',
  low: 'text-muted-foreground',
  medium: 'text-warning',
  high: 'text-destructive',
}

export const PRIORITY_NAMES: Record<ShownPriority, () => string> = {
  none: m.tasks_priority_none,
  low: m.tasks_priority_low,
  medium: m.tasks_priority_medium,
  high: m.tasks_priority_high,
}

/** The small colored flag of a task's priority; nothing when it has none. */
export function PriorityFlag({ priority }: { priority: Task['priority'] }) {
  const shown = shownPriority(priority)
  if (shown === 'none') return null
  const label = m.tasks_priority_label({ priority: PRIORITY_NAMES[shown]() })
  return (
    <Tooltip>
      <TooltipTrigger render={<span aria-label={label} className="inline-flex shrink-0" />}>
        <Flag aria-hidden className={cn('size-3.5 fill-current', PRIORITY_COLORS[shown])} />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
