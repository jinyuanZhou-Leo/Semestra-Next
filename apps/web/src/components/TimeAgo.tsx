import { formatDateTime, formatTimeAgo } from '@/lib/format'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'

/** "1 hour ago", with the full date and time in a tooltip (hover or keyboard focus). */
export function TimeAgo({ value }: { value: string }) {
  return (
    <Tooltip>
      <TooltipTrigger className="cursor-default rounded-sm text-xs text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/30">
        <time dateTime={value}>{formatTimeAgo(value)}</time>
      </TooltipTrigger>
      <TooltipContent>{formatDateTime(value)}</TooltipContent>
    </Tooltip>
  )
}
