import type { Occurrence } from '@semestra/api-client'
import { TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { timeRange } from '../labels'
import { occurrenceColor } from '../occurrence'

/** One line of a timeline or list: time, color bar, type code, title, location and marks. */
export function OccurrenceRow({
  occurrence: o,
  timezone,
  compact = false,
  past = false,
  onClick,
}: {
  occurrence: Occurrence
  timezone: string
  compact?: boolean
  past?: boolean
  onClick?: () => void
}) {
  const cancelled = o.status === 'cancelled'
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'flex w-full items-stretch gap-3 rounded-xl px-2 py-1.5 text-left text-sm',
        onClick && 'hover:bg-muted/60',
        past && 'opacity-60',
      )}
    >
      <span className="w-24 shrink-0 text-xs text-muted-foreground tabular-nums">
        {timeRange(o, timezone)}
      </span>
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
          <span className={cn('truncate font-medium', cancelled && 'line-through')}>
            {o.title}
          </span>
          {(o.meta?.conflicts_with?.length ?? 0) > 0 ? (
            <TriangleAlert
              aria-label={m.schedule_conflict()}
              className="size-3.5 shrink-0 text-destructive"
            />
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
