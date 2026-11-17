import type { CourseOverview, NavTab } from '@semestra/api-client'
import { lmsCourseLinkGetOptions, lmsCourseOverviewOptions } from '@semestra/api-client/react-query'
import type { QueryClient } from '@tanstack/react-query'

type CourseRef = { programId: string; courseId: string }

export const courseLinkOptions = (courseId: string) =>
  lmsCourseLinkGetOptions({ path: { course_id: courseId } })

export const courseOverviewOptions = (courseId: string) =>
  lmsCourseOverviewOptions({ path: { course_id: courseId } })

/** `CourseInfoRow.prefetch` of the linked course row: the course's link. */
export const prefetchCourseLink = ({ courseId }: CourseRef, queryClient: QueryClient) =>
  queryClient.ensureQueryData(courseLinkOptions(courseId))

/** `CourseInfoRow.prefetch` of the course links row: the link, then (if linked) the overview. */
export async function prefetchCourseTools(course: CourseRef, queryClient: QueryClient) {
  const { link } = await prefetchCourseLink(course, queryClient)
  if (link) await queryClient.ensureQueryData(courseOverviewOptions(course.courseId))
}

/**
 * The course's tools on other sites (Piazza, Gradescope…): the external entries of its LMS menu,
 * without the ones the instructor hid, and only web addresses (a platform could hand back
 * `javascript:` or another scheme).
 */
export const externalTools = (overview: CourseOverview): NavTab[] =>
  overview.navigation.filter(
    (tab) => tab.kind === 'external' && !tab.hidden && /^https?:\/\//i.test(tab.web_url ?? ''),
  )
