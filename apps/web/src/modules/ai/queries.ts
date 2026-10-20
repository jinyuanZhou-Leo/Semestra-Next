import type { QueryClient } from '@tanstack/react-query'

/** Generated query ids that show AI configuration; refetched after any change (and via SSE). */
export const AI_QUERIES = [
  'aiStatusGet',
  'aiProviderList',
  'aiAssignmentGet',
  'aiProviderListModels',
]

export function invalidateAi(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    predicate: (query) => {
      // oxlint-disable-next-line no-underscore-dangle -- hey-api's query key field
      const id = (query.queryKey[0] as { _id?: unknown } | undefined)?._id
      return typeof id === 'string' && AI_QUERIES.includes(id)
    },
  })
}
