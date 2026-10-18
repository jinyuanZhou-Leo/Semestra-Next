import type { CalendarOccurrencesData, Meeting } from '@semestra/api-client'
import {
  academicsTermCalendarInfoOptions,
  calendarOccurrencesOptions,
  calendarTodayOptions,
  scheduleConflictsOptions,
  scheduleEventListOptions,
  scheduleEventTypeListOptions,
  scheduleFeedListOptions,
  scheduleMeetingListOptions,
  settingsValuesGetOptions,
} from '@semestra/api-client/react-query'
import { type QueryClient, keepPreviousData, useQueries, useQuery } from '@tanstack/react-query'

const STALE = 30_000

export function useEventTypes(programId: string) {
  return useQuery({
    ...scheduleEventTypeListOptions({ path: { program_id: programId } }),
    staleTime: STALE,
  })
}

export function useMeetings(courseId: string, termId?: string) {
  return useQuery({
    ...scheduleMeetingListOptions({
      path: { course_id: courseId },
      query: termId ? { term_id: termId } : {},
    }),
    staleTime: STALE,
  })
}

/** The meetings of several courses in one term (there is no term-wide list; terms are small). */
export function useTermMeetings(courseIds: readonly string[], termId: string) {
  return useQueries({
    queries: courseIds.map((courseId) => ({
      ...scheduleMeetingListOptions({ path: { course_id: courseId }, query: { term_id: termId } }),
      staleTime: STALE,
    })),
    combine: (results) => ({
      items: results.flatMap((r) => r.data?.items ?? []) as Meeting[],
      isPending: results.some((r) => r.isPending),
    }),
  })
}

export function useConflicts(termId: string) {
  return useQuery({ ...scheduleConflictsOptions({ path: { term_id: termId } }), staleTime: STALE })
}

export function useEvents(programId: string, query: { course_id?: string; term_id?: string }) {
  return useQuery({
    ...scheduleEventListOptions({ path: { program_id: programId }, query }),
    staleTime: STALE,
  })
}

export function useFeeds(programId: string) {
  return useQuery({
    ...scheduleFeedListOptions({ path: { program_id: programId } }),
    staleTime: STALE,
  })
}

/** The term's weeks (M02), for week pickers and labels. */
export function useCalendarInfo(termId: string) {
  return useQuery({
    ...academicsTermCalendarInfoOptions({ path: { term_id: termId } }),
    staleTime: STALE,
  })
}

export function useToday(programId: string) {
  return useQuery({
    ...calendarTodayOptions({ path: { program_id: programId } }),
    staleTime: STALE,
    // Keep "now" fresh on a page that stays open all day.
    refetchInterval: 5 * 60_000,
  })
}

export type OccurrenceParams = CalendarOccurrencesData['query']

export function useOccurrences(programId: string, params: OccurrenceParams, enabled = true) {
  return useQuery({
    ...calendarOccurrencesOptions({ path: { program_id: programId }, query: params }),
    staleTime: STALE,
    placeholderData: keepPreviousData,
    enabled,
  })
}

export type CalendarSettings = {
  default_view: 'week' | 'month' | 'list' | 'timetable'
  day_start: string
  day_end: string
  show_weekends: boolean
  min_column_width: number
  cancelled_display: 'strike' | 'hide'
}

export const DEFAULT_CALENDAR_SETTINGS: CalendarSettings = {
  default_view: 'week',
  day_start: '08:00',
  day_end: '22:00',
  show_weekends: true,
  min_column_width: 0,
  cancelled_display: 'strike',
}

/** The `calendar` namespace (M11), resolved for a term when given. */
export function useCalendarSettings(termId?: string): CalendarSettings {
  const values = useQuery({
    ...settingsValuesGetOptions({
      path: { namespace: 'calendar' },
      query: termId ? { scope_type: 'term', scope_id: termId } : { scope_type: 'account' },
    }),
    staleTime: STALE,
  }).data?.values
  return { ...DEFAULT_CALENDAR_SETTINGS, ...(values as Partial<CalendarSettings> | undefined) }
}

function operationId(queryKey: readonly unknown[]): string {
  // oxlint-disable-next-line no-underscore-dangle -- hey-api's query key field
  return String((queryKey[0] as { _id?: unknown } | undefined)?._id ?? '')
}

/** Refetch the calendar and schedule queries after a change made from this tab. */
export function invalidateSchedule(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    predicate: (query) => {
      const id = operationId(query.queryKey)
      return id.startsWith('schedule') || id.startsWith('calendar')
    },
  })
}
