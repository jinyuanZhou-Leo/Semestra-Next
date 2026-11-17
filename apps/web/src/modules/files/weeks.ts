import type { CalendarInfo, ItemOut } from '@semestra/api-client'
import {
  academicsCourseGetOptions,
  academicsTermGetWeeksOptions,
  academicsTermListOptions,
} from '@semestra/api-client/react-query'
import { type QueryClient, useQueries } from '@tanstack/react-query'
import { formatDate } from '@/lib/format'
import { useCourse, useTerms } from '@/modules/academics/queries'
import { m } from '@/paraglide/messages'

/** One week of a course's terms: what files are put in (by its first day) and filtered by. */
export type WeekOption = {
  /** The week's first day, `YYYY-MM-DD`: an item's `week` and the `?week=` of the page. */
  start: string
  end: string
  number: number | null
  /** An uncounted break week's name ("Reading week"). */
  breakName: string | null
  current: boolean
}

export type TermWeeks = { termId: string; name: string; weeks: WeekOption[] }

/** The weeks of a course's terms, grouped by term (a year-long course has two). */
export type CourseWeeks = {
  terms: TermWeeks[]
  /** Today's week, when today is in one of the course's terms. */
  current: WeekOption | null
  /** The week a day falls in. */
  find: (day: string | null | undefined) => WeekOption | null
}

/** `?week=` of the files page: every file, the whole term's, or one week's (its first day). */
export type WeekFilter = 'all' | 'term' | string

/** "Week 3", or the break's name for a week that is not counted. */
export function weekName(week: WeekOption): string {
  return week.number === null
    ? (week.breakName ?? '')
    : m.files_week_number({ number: week.number })
}

/** "Week 3 (this week)": a week as the filter and the pickers list it. */
export function weekLabel(week: WeekOption): string {
  return week.current ? m.files_week_this({ week: weekName(week) }) : weekName(week)
}

export function weekDates(week: WeekOption): string {
  return `${formatDate(week.start, { short: true })} – ${formatDate(week.end, { short: true })}`
}

function options(info: CalendarInfo): WeekOption[] {
  return info.weeks.map((w, index) => ({
    start: w.start_date,
    end: w.end_date,
    number: w.number,
    breakName: w.break_info?.name ?? null,
    current: info.today_week === index,
  }))
}

export function courseWeeks(terms: TermWeeks[]): CourseWeeks {
  const all = terms.flatMap((t) => t.weeks)
  return {
    terms,
    current: all.find((w) => w.current) ?? null,
    find: (day) => (day ? (all.find((w) => w.start <= day && day <= w.end) ?? null) : null),
  }
}

/** Whether an item shows under the filter. */
export function inWeek(item: ItemOut, filter: WeekFilter, weeks: CourseWeeks): boolean {
  if (filter === 'all') return true
  if (filter === 'term') return item.week === null
  return item.week !== null && weeks.find(item.week)?.start === filter
}

/** What `useCourseWeeks` reads, started with the files page (its filter and lists need it). */
export async function prefetchCourseWeeks(
  queryClient: QueryClient,
  programId: string,
  courseId: string,
): Promise<void> {
  void queryClient.prefetchQuery(academicsTermListOptions({ path: { program_id: programId } }))
  const course = await queryClient.fetchQuery(
    academicsCourseGetOptions({ path: { course_id: courseId } }),
  )
  for (const termId of course.term_ids) {
    void queryClient.prefetchQuery(academicsTermGetWeeksOptions({ path: { term_id: termId } }))
  }
}

/** The course's weeks (undefined while they load; no terms: none). */
export function useCourseWeeks(courseId: string): CourseWeeks | undefined {
  const course = useCourse(courseId, { enabled: Boolean(courseId) }).data
  const terms = useTerms(course?.program_id ?? '').data
  const termIds = course?.term_ids ?? []
  const infos = useQueries({
    queries: termIds.map((termId) => academicsTermGetWeeksOptions({ path: { term_id: termId } })),
  })
  if (!course || !terms || infos.some((q) => !q.data)) return undefined
  const order = new Map(terms.items.map((t, i) => [t.id, i]))
  return courseWeeks(
    termIds
      .toSorted((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
      .map((termId) => {
        const info = infos[termIds.indexOf(termId)]?.data as CalendarInfo
        const name = terms.items.find((t) => t.id === termId)?.name ?? ''
        return { termId, name, weeks: options(info) }
      }),
  )
}
