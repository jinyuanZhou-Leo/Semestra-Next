import type { CourseOverview } from '@semestra/api-client'
import {
  lmsAnnouncementListOptions,
  lmsAssignmentListOptions,
  lmsCourseOverviewOptions,
  lmsFolderGetOptions,
  lmsModuleListOptions,
  lmsPageGetOptions,
  lmsPageListOptions,
  lmsQuizListOptions,
  lmsSyllabusGetOptions,
} from '@semestra/api-client/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { Scope } from '@/app/extensions'
import { cachedUiPref } from '@/app/ui-pref'
import { homeView } from './navigation'

/** M09's page ref for the course's front page (Canvas `GET /courses/:id/front_page`). */
export const FRONT_PAGE_REF = '@front'

type Place = { tab: string; ref?: string }

/**
 * Starts what a view of the tab reads first, for the page's prefetch: the same options the views
 * use, so they find the data in the cache. The home view follows the course's `default_view`.
 */
function prefetchView(
  queryClient: QueryClient,
  courseId: string,
  place: Place,
  overview?: CourseOverview,
): void {
  const path = { course_id: courseId }
  switch (place.tab) {
    case 'announcements':
      void queryClient.prefetchQuery(lmsAnnouncementListOptions({ path }))
      return
    case 'assignments':
    case 'quizzes':
    case 'grades':
      void queryClient.prefetchQuery(lmsAssignmentListOptions({ path }))
      void queryClient.prefetchQuery(lmsQuizListOptions({ path }))
      return
    case 'files':
      void queryClient.prefetchQuery(lmsFolderGetOptions({ path, query: { folder_id: place.ref } }))
      return
    case 'modules':
      void queryClient.prefetchQuery(lmsModuleListOptions({ path }))
      return
    case 'pages':
      if (place.ref) {
        void queryClient.prefetchQuery(lmsPageGetOptions({ path: { ...path, ref: place.ref } }))
      } else void queryClient.prefetchQuery(lmsPageListOptions({ path }))
      return
    case 'syllabus':
      void queryClient.prefetchQuery(lmsSyllabusGetOptions({ path }))
      return
    case 'home': {
      if (!overview) return
      const home = homeView(overview.default_view ?? overview.course.default_view)
      if (home === 'front_page') {
        void queryClient.prefetchQuery(
          lmsPageGetOptions({ path: { ...path, ref: FRONT_PAGE_REF } }),
        )
      } else prefetchView(queryClient, courseId, { tab: home })
      return
    }
    default:
  }
}

/**
 * The Canvas tab's prefetch (M10 pages): the course's overview and, alongside it, what the view
 * the tab opens on reads (the place the user left it, M16 §3), so the view doesn't wait for the
 * overview before asking. The home view needs the overview first. A hovered link only starts the
 * overview.
 */
export function prefetchCanvasPage(
  scope: Scope,
  queryClient: QueryClient,
  { preload }: { preload: boolean },
) {
  if (scope.kind !== 'course') return
  const courseId = scope.courseId
  const options = lmsCourseOverviewOptions({ path: { course_id: courseId } })
  const overview = queryClient.prefetchQuery(options)
  if (preload) return
  const place = cachedUiPref<Place>(queryClient, `canvas-tab.location.${courseId}`) ?? {
    tab: 'home',
  }
  if (place.tab === 'home') {
    void overview.then(() =>
      prefetchView(queryClient, courseId, place, queryClient.getQueryData(options.queryKey)),
    )
    return
  }
  prefetchView(queryClient, courseId, place)
}
