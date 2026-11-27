import {
  lmsAnnouncementUnreadOptions,
  lmsCourseLinkListOptions,
} from '@semestra/api-client/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { Scope } from '@/app/extensions'
import { courseOverviewOptions } from '@/modules/lms/course-info'
import { programLinksOptions } from '../open-in-canvas'

/** The Program's unread announcements per course (one request for all its courses). */
export const unreadOptions = (programId: string) =>
  lmsAnnouncementUnreadOptions({ path: { program_id: programId } })

/** The term's course links (the term card's rows), as the term 公告 page asks for them. */
export const termLinksOptions = (programId: string, termId: string) => ({
  ...lmsCourseLinkListOptions({ path: { program_id: programId }, query: { term_id: termId } }),
  staleTime: 60_000,
})

/**
 * `CardContribution.prefetch`: the links, the unread counts and, as soon as the links say which
 * courses are on Canvas, their menus, so the cards first render with everything they show.
 */
export function prefetchCards(scope: Scope, queryClient: QueryClient) {
  void queryClient.prefetchQuery(unreadOptions(scope.programId))
  const links =
    scope.kind === 'term'
      ? termLinksOptions(scope.programId, scope.termId)
      : programLinksOptions(scope.programId)
  queryClient
    .ensureQueryData(links)
    .then(({ items }) => {
      for (const link of items) {
        if (link.provider !== 'canvas') continue
        if (scope.kind === 'course' && link.course_id !== scope.courseId) continue
        void queryClient.prefetchQuery(courseOverviewOptions(link.course_id))
      }
    })
    // The cards ask again and show the error themselves.
    .catch(() => {})
}
