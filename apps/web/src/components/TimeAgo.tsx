import { formatTimeAgo } from '@/lib/format'

/** "1 hour ago" for a status line; the exact time stays in `dateTime` (owner: no tooltip). */
export function TimeAgo({ value }: { value: string }) {
  return (
    <time dateTime={value} className="text-xs text-muted-foreground">
      {formatTimeAgo(value)}
    </time>
  )
}
