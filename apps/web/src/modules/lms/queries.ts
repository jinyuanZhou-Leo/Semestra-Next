import type { QueryClient } from '@tanstack/react-query'

/**
 * Generated query ids that show LMS state or content read through a connection; refetched after
 * a change (and via SSE), so a relinked course or edited connection never shows the old data.
 */
export const LMS_QUERIES = [
  'lmsConnectionList',
  'lmsProgramBindingGet',
  'lmsCourseList',
  'lmsCourseLinkGet',
  'lmsCourseCheckUpdates',
  'lmsCourseOverview',
  'lmsAssignmentList',
  'lmsAnnouncementList',
  'lmsGradeList',
  'lmsModuleList',
  'lmsModuleItemList',
  'lmsPageList',
  'lmsPageGet',
  'lmsQuizList',
  'lmsSyllabusGet',
  'lmsFileGet',
]

export function invalidateLms(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    predicate: (query) => {
      // oxlint-disable-next-line no-underscore-dangle -- hey-api's query key field
      const id = (query.queryKey[0] as { _id?: unknown } | undefined)?._id
      return typeof id === 'string' && LMS_QUERIES.includes(id)
    },
  })
}
