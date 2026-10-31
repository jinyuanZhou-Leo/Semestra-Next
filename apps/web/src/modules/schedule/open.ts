import type { Occurrence } from '@semestra/api-client'
import { useRouter } from '@tanstack/react-router'
import { useCalendarSources } from '@/app/registry'

/**
 * Opens an occurrence the way its calendar source says (`CalendarSourceContribution.onOpen`):
 * a class or event its course, a deadline the gradebook, a task the task. Returns undefined for
 * occurrences whose source has no open action, so their rows stay plain text.
 */
export function useOpenOccurrence(programId: string) {
  const router = useRouter()
  const sources = useCalendarSources()
  return (o: Occurrence): (() => void) | undefined => {
    const open = sources.find((s) => s.source === o.source)?.onOpen
    if (!open) return undefined
    return () => open(o, (to) => router.history.push(to), { programId })
  }
}
