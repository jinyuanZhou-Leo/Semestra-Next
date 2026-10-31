import type { Occurrence } from '@semestra/api-client'
import { TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { timeParts } from '../labels'
import { occurrenceColor } from '../occurrence'

/**
 * One line of a timeline or list: time, color bar, type code, title, location and marks. The time
 * column puts start and end on two lines so neither wraps; all-day items leave it empty, and lists
 * of only all-day items drop it (`time={false}`).
 */
export function OccurrenceRow({
  occurrence: o,
  timezone,
  compact = false,
  past = false,
  time = true,
  allDayLabel = true,
  onClick,
}: {
  occurrence: Occurrence
  timezone: string
  compact?: boolean
  past?: boolean
  time?: boolean
  /** "All day" in the time column; lists grouped by day leave it out. */
  allDayLabel?: boolean
  onClick?: () => void
}) {
  const cancelled = o.status === 'cancelled'
  const Tag = onClick ? 'button' : 'div'
  const [start, end] = o.all_day ? [null, null] : timeParts(o, timezone)
  const conflicts = o.meta?.conflicts_with?.length ?? 0
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'flex w-full items-stretch gap-3 rounded-xl px-2 py-1.5 text-left text-sm',
        onClick && 'transition-colors hover:bg-muted/60',
        past && 'opacity-60',
      )}
    >
      {time ? (
        <span className="flex w-16 shrink-0 flex-col text-xs whitespace-nowrap tabular-nums">
          {start ? <span className="font-medium">{start}</span> : null}
          {end ? <span className="text-muted-foreground">{end}</span> : null}
          {o.all_day && allDayLabel ? (
            <span className="text-muted-foreground">{m.schedule_all_day()}</span>
          ) : null}
        </span>
      ) : null}
      <span
        aria-hidden
        className="w-1 shrink-0 rounded-full"
        style={{ backgroundColor: occurrenceColor(o) }}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          {o.type_code ? (
            <span className="text-xs font-medium text-muted-foreground">{o.type_code}</span>
          ) : null}
          <span className={cn('truncate font-medium', cancelled && 'line-through')}>{o.title}</span>
          {conflicts > 0 ? (
            <Tooltip>
              <TooltipTrigger
                render={<span className="inline-flex shrink-0" />}
                aria-label={m.schedule_conflict()}
              >
                <TriangleAlert aria-hidden className="size-3.5 text-destructive" />
              </TooltipTrigger>
              <TooltipContent>{m.schedule_conflict()}</TooltipContent>
            </Tooltip>
          ) : null}
        </span>
        {!compact && o.location ? (
          <span className="block truncate text-xs text-muted-foreground">{o.location}</span>
        ) : null}
      </span>
      {cancelled ? (
        <Badge variant="secondary" className="self-center">
          {m.schedule_status_cancelled()}
        </Badge>
      ) : o.status === 'moved' ? (
        <Badge variant="secondary" className="self-center">
          {m.schedule_status_moved()}
        </Badge>
      ) : o.status === 'overdue' ? (
        <Badge variant="destructive" className="self-center">
          {m.schedule_status_overdue()}
        </Badge>
      ) : null}
    </Tag>
  )
}
