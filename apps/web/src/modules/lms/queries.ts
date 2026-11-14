import type { Query, QueryClient } from '@tanstack/react-query'

/**
 * Generated query ids of the LMS state: connections, bindings, links, the platform's course
 * list, a course's overview and the Program's sync status. Refetched after any
 * LMS change (and via SSE), so a relinked course or edited connection never shows the old state.
 */
export const LMS_STATE_QUERIES = [
  'lmsConnectionList',
  'lmsProgramBindingGet',
  'lmsCourseList',
  'lmsCourseLinkGet',
  'lmsCourseLinkList',
  'lmsCourseOverview',
  'lmsSyncStatus',
]

/** What linked courses hold on the platform: refetched for one course, not on every change. */
export const LMS_CONTENT_QUERIES = [
  'lmsAssignmentList',
  'lmsAnnouncementList',
  'lmsTermAnnouncementList',
  'lmsGradeList',
  'lmsModuleList',
  'lmsModuleItemList',
  'lmsPageList',
  'lmsPageGet',
  'lmsQuizList',
  'lmsSyllabusGet',
  'lmsFileGet',
  'lmsSubmissionGet',
  'lmsFolderGet',
  'lmsFileSearch',
  'lmsFilePreview',
]

export const LMS_QUERIES = [...LMS_STATE_QUERIES, ...LMS_CONTENT_QUERIES]

/**
 * What a course's platform pages show (the provider's tab, cards, pickers), kept in the browser
 * between visits (`keptQueries`): opened again, a view shows what it showed last time at once
 * and fetches the platform's current state behind it.
 */
export const LMS_KEPT_QUERIES = [
  'lmsCourseOverview',
  'lmsAnnouncementList',
  'lmsAssignmentList',
  'lmsQuizList',
  'lmsSubmissionGet',
  'lmsModuleList',
  'lmsModuleItemList',
  'lmsPageList',
  'lmsPageGet',
  'lmsSyllabusGet',
  'lmsFolderGet',
]

/** hey-api's query key: `_id` is the operation, `path` its path parameters. */
function keyOf(query: Query) {
  return query.queryKey[0] as { _id?: unknown; path?: { course_id?: unknown } } | undefined
}

function idOf(query: Query) {
  // oxlint-disable-next-line no-underscore-dangle -- hey-api's query key field
  const id = keyOf(query)?._id
  return typeof id === 'string' ? id : null
}

/** One course's platform reads, and the term card that lists its announcements. */
export function isCourseContent(courseId: string) {
  return (query: Query) => {
    const id = idOf(query)
    if (id === null || !LMS_CONTENT_QUERIES.includes(id)) return false
    return id === 'lmsTermAnnouncementList' || keyOf(query)?.path?.course_id === courseId
  }
}

/**
 * Refetches the LMS state after a change; with `courseId` also that course's content, with
 * `all` every course's (a connection's credentials or config changed).
 */
export function invalidateLms(
  queryClient: QueryClient,
  { courseId, all }: { courseId?: string; all?: boolean } = {},
) {
  const course = courseId ? isCourseContent(courseId) : null
  return queryClient.invalidateQueries({
    predicate: (query) => {
      const id = idOf(query)
      if (id === null) return false
      if (LMS_STATE_QUERIES.includes(id)) return true
      if (all) return LMS_CONTENT_QUERIES.includes(id)
      return course?.(query) ?? false
    },
  })
}
