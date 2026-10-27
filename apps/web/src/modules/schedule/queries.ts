import type { CalendarOccurrenceListData, Meeting, Term } from '@semestra/api-client'
import {
  academicsProgramGetOptions,
  academicsTermGetWeeksOptions,
  academicsTermListOptions,
  calendarOccurrenceListOptions,
  calendarTodayGetOptions,
  scheduleConflictListOptions,
  scheduleEventListOptions,
  scheduleEventTypeListOptions,
  scheduleFeedListOptions,
  scheduleMeetingListForTermOptions,
  scheduleMeetingListOptions,
  settingsValueGetOptions,
} from '@semestra/api-client/react-query'
import { type QueryClient, keepPreviousData, useQuery } from '@tanstack/react-query'
import { addMonths } from 'date-fns'
import type { ModuleManifest, Scope } from '@/app/extensions'
import { readUiPref } from '@/app/ui-pref'
import { firstDayOfWeek } from '@/lib/format'
import { courseListOptions } from '@/modules/academics/queries'
import { type CalendarFilters, DEFAULT_FILTERS, visibleSources } from './filters'
import { isoDay, localDay, plusDays, todayIn, weekStartOf } from './time'

export function useEventTypes(programId: string) {
  return useQuery({
    ...scheduleEventTypeListOptions({ path: { program_id: programId } }),
  })
}

export function useMeetings(courseId: string, termId?: string) {
  return useQuery({
    ...scheduleMeetingListOptions({
      path: { course_id: courseId },
      query: termId ? { term_id: termId } : {},
    }),
  })
}

/** Every meeting of the term's courses (the timetable and the export). */
export function useTermMeetings(termId: string, enabled = true) {
  const query = useQuery({
    ...scheduleMeetingListForTermOptions({ path: { term_id: termId } }),
    enabled,
  })
  return { items: query.data?.items ?? NO_MEETINGS, isPending: query.isPending }
}

const NO_MEETINGS: Meeting[] = []

export function useConflicts(termId: string) {
  return useQuery({
    ...scheduleConflictListOptions({ path: { term_id: termId } }),
  })
}

export function useEvents(programId: string, query: { course_id?: string; term_id?: string }) {
  return useQuery({
    ...scheduleEventListOptions({ path: { program_id: programId }, query }),
  })
}

export function useFeeds(programId: string, enabled = true) {
  return useQuery({
    ...scheduleFeedListOptions({ path: { program_id: programId } }),
    enabled,
  })
}

/** The term's weeks (M02), for week pickers and labels. */
export function useCalendarInfo(termId: string) {
  return useQuery({
    ...academicsTermGetWeeksOptions({ path: { term_id: termId } }),
  })
}

export function useToday(programId: string) {
  return useQuery({
    ...calendarTodayGetOptions({ path: { program_id: programId } }),
    // Keep "now" fresh on a page that stays open all day.
    refetchInterval: 5 * 60_000,
  })
}

export type OccurrenceParams = CalendarOccurrenceListData['query']

export function occurrenceOptions(programId: string, params: OccurrenceParams) {
  return calendarOccurrenceListOptions({ path: { program_id: programId }, query: params })
}

export function useOccurrences(programId: string, params: OccurrenceParams, enabled = true) {
  return useQuery({
    ...occurrenceOptions(programId, params),
    placeholderData: keepPreviousData,
    enabled,
  })
}

export type CalendarView = CalendarSettings['default_view']
/** Where the term calendar was left (`calendar.nav.<termId>`): its view and a day it showed. */
export type CalendarNav = { view: CalendarView; date: string }

/** The day the calendar opens on: where it was left, else today within the term, else its start. */
export function calendarAnchor(
  nav: CalendarNav | null | undefined,
  term: Pick<Term, 'start_date' | 'end_date'>,
  today: string,
): string {
  return nav?.date ?? (today >= term.start_date && today <= term.end_date ? today : term.start_date)
}

/**
 * The days the calendar asks occurrences for: the week around `date`, or the six-week grid of its
 * month. Worked out here instead of read back from FullCalendar, so the request starts with the
 * page (and from its prefetch) rather than after the calendar has drawn. It covers what
 * FullCalendar shows, which may be less (hidden weekends); occurrences outside are not drawn.
 */
export function occurrenceRange(
  view: Exclude<CalendarView, 'timetable'>,
  date: string,
  firstDay: 1 | 7,
): { start: string; end: string } {
  if (view === 'month') {
    const start = weekStartOf(`${date.slice(0, 7)}-01`, firstDay)
    return { start, end: plusDays(start, 42) }
  }
  const start = weekStartOf(date, firstDay)
  return { start, end: plusDays(start, 7) }
}

/** A day in the period before (`-1`) or after (`1`) the one `date` is in, as the arrows move. */
export function stepPeriod(view: Exclude<CalendarView, 'timetable'>, date: string, step: -1 | 1) {
  return view === 'month'
    ? isoDay(addMonths(localDay(`${date.slice(0, 7)}-01`), step))
    : plusDays(date, 7 * step)
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
  return useCalendarSettingsState(termId).settings
}

function calendarSettingsOptions(termId?: string) {
  return settingsValueGetOptions({
    path: { namespace: 'calendar' },
    query: termId ? { scope_type: 'term', scope_id: termId } : { scope_type: 'account' },
  })
}

/**
 * What the term calendar needs (`PageContribution.prefetch`): its settings, the term's weeks and
 * courses, and what it opens on: the occurrences of the first week (or month), or the meetings
 * when it opens on the timetable. A hovered link gets the cheap part only.
 */
export function prefetchCalendarPage(
  scope: Scope,
  queryClient: QueryClient,
  { preload, modules }: { preload: boolean; modules: readonly ModuleManifest[] },
) {
  if (scope.kind !== 'term') return
  const { programId, termId } = scope
  void queryClient.prefetchQuery(academicsTermGetWeeksOptions({ path: { term_id: termId } }))
  const settings = queryClient.fetchQuery(calendarSettingsOptions(termId))
  const courses = queryClient.fetchQuery(courseListOptions(programId, termId))
  const opening = preload
    ? Promise.resolve()
    : Promise.all([
        settings,
        readUiPref<CalendarNav>(queryClient, `calendar.nav.${termId}`),
        readUiPref<CalendarFilters>(queryClient, `calendar.filters.${termId}`),
        queryClient.fetchQuery(academicsProgramGetOptions({ path: { program_id: programId } })),
        queryClient.fetchQuery(academicsTermListOptions({ path: { program_id: programId } })),
      ]).then(([values, nav, filters, program, terms]) => {
        const defaults = {
          ...DEFAULT_CALENDAR_SETTINGS,
          ...(values.values as Partial<CalendarSettings>),
        }
        const view = nav?.view ?? defaults.default_view
        if (view === 'timetable') {
          return queryClient.prefetchQuery(
            scheduleMeetingListForTermOptions({ path: { term_id: termId } }),
          )
        }
        const term = terms.items.find((t) => t.id === termId)
        const sources = visibleSources(
          filters ?? DEFAULT_FILTERS,
          modules.flatMap((m) => m.calendarSources ?? []),
        )
        if (!term || sources.length === 0) return
        const date = calendarAnchor(nav, term, todayIn(program.timezone))
        return queryClient.prefetchQuery(
          occurrenceOptions(programId, {
            ...occurrenceRange(view, date, firstDayOfWeek()),
            term_id: termId,
            sources,
          }),
        )
      })
  // The page's own queries report errors.
  Promise.all([settings, courses, opening]).catch(() => undefined)
}

/** `useCalendarSettings` plus whether the Program's values are still loading (defaults only). */
export function useCalendarSettingsState(termId?: string): {
  settings: CalendarSettings
  isPending: boolean
} {
  const query = useQuery(calendarSettingsOptions(termId))
  const values = query.data?.values as Partial<CalendarSettings> | undefined
  return { settings: { ...DEFAULT_CALENDAR_SETTINGS, ...values }, isPending: query.isPending }
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
