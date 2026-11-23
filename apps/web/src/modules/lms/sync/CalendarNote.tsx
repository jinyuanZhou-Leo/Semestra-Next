import type { SyncStatus } from '@semestra/api-client'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { syncStatusOptions } from './status'

/**
 * How many courses' calendars the sync has not read yet, or never could (M09 §4.8), a line each;
 * nothing once they are read. In the sync panel and under the platform in the calendar's filters.
 */
export function CalendarLines({
  status,
  className,
}: {
  status: SyncStatus | undefined
  className?: string
}) {
  const lines = [
    status?.calendar_waiting ? m.lms_calendar_waiting({ count: status.calendar_waiting }) : null,
    status?.calendar_unreadable
      ? m.lms_calendar_unreadable({ count: status.calendar_unreadable })
      : null,
  ].filter((line) => line !== null)
  if (lines.length === 0) return null
  return (
    <div className={cn('space-y-0.5 text-xs text-muted-foreground', className)}>
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  )
}

/** Under the platform in the calendar's filters (`calendarSources` `Note`). */
export function CalendarNote({ programId }: { programId: string }) {
  return <CalendarLines status={useQuery(syncStatusOptions(programId)).data} className="pl-6" />
}
