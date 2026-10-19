import type { QueryClient } from '@tanstack/react-query'

/** Generated query ids that show LMS state; refetched after a change (and via SSE). */
export const LMS_QUERIES = [
  'lmsConnectionList',
  'lmsProgramBindingGet',
  'lmsCoursesList',
  'lmsCourseLinkGet',
  'lmsCourseCheckUpdates',
  'lmsAssignmentsList',
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
