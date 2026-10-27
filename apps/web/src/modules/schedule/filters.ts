import type { CalendarSourceContribution } from '@/app/extensions'

/** The calendar's filters, saved per term (`calendar.filters.<termId>`, M04 §5.2). */
export type CalendarFilters = {
  /** Sources the user switched on or off; others follow their `defaultVisible`. */
  sources: Record<string, boolean>
  /** Hidden rather than shown, so a new course appears without touching the filters. */
  hiddenCourses: string[]
  /** null follows the "cancelled classes" preference. */
  showCancelled: boolean | null
}

export const DEFAULT_FILTERS: CalendarFilters = {
  sources: {},
  hiddenCourses: [],
  showCancelled: null,
}

export function visibleSources(
  filters: CalendarFilters,
  sources: readonly CalendarSourceContribution[],
): string[] {
  return sources.filter((s) => filters.sources[s.source] ?? s.defaultVisible).map((s) => s.source)
}
