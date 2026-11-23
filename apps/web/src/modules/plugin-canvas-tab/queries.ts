import type { CourseOverview } from '@semestra/api-client'
import {
  lmsAnnouncementListOptions,
  lmsAssignmentListOptions,
  lmsFolderGetOptions,
  lmsModuleListOptions,
  lmsPageGetOptions,
  lmsPageListOptions,
  lmsQuizListOptions,
  lmsSyllabusGetOptions,
} from '@semestra/api-client/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { homeView, type CanvasLocation } from './navigation'

/** M09's page ref for the course's front page (Canvas `GET /courses/:id/front_page`). */
export const FRONT_PAGE_REF = '@front'

/**
 * The reads the tab's views start with, one definition each: the views query them and the
 * page's prefetch starts them (`placeQueries`), so the two never ask for different data.
 */
export const viewQueries = {
  announcements: (courseId: string) =>
    lmsAnnouncementListOptions({ path: { course_id: courseId } }),
  assignments: (courseId: string) => lmsAssignmentListOptions({ path: { course_id: courseId } }),
  quizzes: (courseId: string) => lmsQuizListOptions({ path: { course_id: courseId } }),
  folder: (courseId: string, folderId: string | undefined) =>
    lmsFolderGetOptions({ path: { course_id: courseId }, query: { folder_id: folderId } }),
  modules: (courseId: string) => lmsModuleListOptions({ path: { course_id: courseId } }),
  pages: (courseId: string) => lmsPageListOptions({ path: { course_id: courseId } }),
  page: (courseId: string, ref: string) =>
    lmsPageGetOptions({ path: { course_id: courseId, ref } }),
  syllabus: (courseId: string) => lmsSyllabusGetOptions({ path: { course_id: courseId } }),
}

/** Starts one of `viewQueries` in the cache. */
type Start = (queryClient: QueryClient) => Promise<void>

/**
 * Starts what the view at `place` reads first (call each with the query client). The home view follows the course's `default_view`, so it
 * needs the overview; without it, nothing.
 */
export function placeQueries(
  courseId: string,
  place: CanvasLocation,
  overview?: CourseOverview,
): Start[] {
  switch (place.tab) {
    case 'announcements':
      return [(qc) => qc.prefetchQuery(viewQueries.announcements(courseId))]
    case 'assignments':
    case 'quizzes':
    case 'grades':
      return [
        (qc) => qc.prefetchQuery(viewQueries.assignments(courseId)),
        (qc) => qc.prefetchQuery(viewQueries.quizzes(courseId)),
      ]
    case 'files':
      return [(qc) => qc.prefetchQuery(viewQueries.folder(courseId, place.ref))]
    case 'modules':
      return [(qc) => qc.prefetchQuery(viewQueries.modules(courseId))]
    case 'pages': {
      const ref = place.ref
      return [
        ref
          ? (qc) => qc.prefetchQuery(viewQueries.page(courseId, ref))
          : (qc) => qc.prefetchQuery(viewQueries.pages(courseId)),
      ]
    }
    case 'syllabus':
      return [(qc) => qc.prefetchQuery(viewQueries.syllabus(courseId))]
    case 'home': {
      if (!overview) return []
      const home = homeView(overview.default_view ?? overview.course.default_view)
      return home === 'front_page'
        ? [(qc) => qc.prefetchQuery(viewQueries.page(courseId, FRONT_PAGE_REF))]
        : placeQueries(courseId, { tab: home })
    }
    default:
      return []
  }
}
