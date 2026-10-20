import type { Task } from '@semestra/api-client'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { type ShownPriority, shownPriority } from '../types'

/**
 * Color of each level's marks (M05 §5.1). None of them follows the accent color, so the levels
 * stay apart under any accent and apart from the flag (primary).
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

/** Like Reminders and quick add: `!` low, `!!` medium, `!!!` high. */
const MARKS: Record<ShownPriority, string> = { none: '', low: '!', medium: '!!', high: '!!!' }

/**
 * A level's exclamation marks, in the space of an icon so menu items line up. `none` keeps the
 * space empty; `placeholder` shows a muted `!` where a priority is not set yet (a chip, a menu).
 */
export function PriorityMarks({
  level,
  placeholder,
  className,
}: {
  level: ShownPriority
  placeholder?: boolean
  className?: string
}) {
  const shown = level === 'none' && placeholder
  return (
    <span
      aria-hidden
      data-icon
      className={cn(
        'inline-flex min-w-4 shrink-0 items-center justify-center text-sm leading-none font-bold tracking-tighter',
        shown ? 'text-muted-foreground' : PRIORITY_COLORS[level],
        className,
      )}
    >
      {shown ? '!' : MARKS[level]}
    </span>
  )
}

/** A task's priority marks before its title, with the level as a tooltip; nothing for none. */
export function TaskPriority({ priority }: { priority: Task['priority'] }) {
  const shown = shownPriority(priority)
  if (shown === 'none') return null
  const label = m.tasks_priority_label({ priority: PRIORITY_NAMES[shown]() })
  return (
    <Tooltip>
      <TooltipTrigger render={<span aria-label={label} className="inline-flex shrink-0" />}>
        <PriorityMarks level={shown} className="min-w-0 text-base" />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
