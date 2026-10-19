import { client } from '@semestra/api-client'
import type { ItemOut } from '@semestra/api-client'
import {
  filesItemGetOptions,
  filesListOptions,
  filesPinnedOptions,
  filesUsageOptions,
} from '@semestra/api-client/react-query'
import { type QueryClient, useQuery } from '@tanstack/react-query'

const STALE = 30_000

/**
 * Everything in a course (all folders), in one request: folders are browsed on the client, which
 * also gives the name filter and the duplicate check the whole course without more requests.
 */
export function useCourseFiles(courseId: string) {
  return useQuery({
    ...filesListOptions({
      path: { course_id: courseId },
      query: { recursive: true, limit: 500, sort: 'name' },
    }),
    staleTime: STALE,
  })
}

export function useFileItem(itemId: string | null | undefined) {
  return useQuery({
    ...filesItemGetOptions({ path: { item_id: itemId ?? '' } }),
    enabled: Boolean(itemId),
    staleTime: STALE,
  })
}

export function useFilesUsage() {
  return useQuery({ ...filesUsageOptions(), staleTime: STALE })
}

export function usePinnedFiles(programId: string) {
  return useQuery({ ...filesPinnedOptions({ path: { program_id: programId } }), staleTime: STALE })
}

function operationId(queryKey: readonly unknown[]): string {
  // oxlint-disable-next-line no-underscore-dangle -- hey-api's query key field
  return String((queryKey[0] as { _id?: unknown } | undefined)?._id ?? '')
}

/** Refetch everything the files module shows, after a change made from this tab. */
export function invalidateFiles(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    predicate: (query) => operationId(query.queryKey).startsWith('files'),
  })
}

/** Address of a file's bytes, for links, `<img>` and the PDF viewer (cookies authenticate it). */
export function contentUrl(itemId: string, disposition: 'inline' | 'attachment' = 'inline') {
  return client.buildUrl({
    url: '/files/{item_id}/content',
    path: { item_id: itemId },
    query: { disposition },
  })
}

/** A small picture of one page of a processed file (only when `doc_status` is ready). */
export function pageImageUrl(itemId: string, page: number) {
  return client.buildUrl({
    url: '/files/{item_id}/pages/{page}.png',
    path: { item_id: itemId, page },
  })
}

export function isProcessing(item: Pick<ItemOut, 'doc_status'>) {
  return item.doc_status === 'pending' || item.doc_status === 'processing'
}
