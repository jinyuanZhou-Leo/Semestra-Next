import { client, filesItemList } from '@semestra/api-client'
import type { FilesItemList } from '@semestra/api-client'
import {
  filesItemGetOptions,
  filesItemListQueryKey,
  filesUsageGetOptions,
} from '@semestra/api-client/react-query'
import { type QueryClient, queryOptions, useQuery } from '@tanstack/react-query'
import type { Scope } from '@/app/extensions'
import { courseListOptions, coursesOfTerm } from '@/modules/academics/queries'

const PAGE_SIZE = 500

/** Every file and folder of a course, following the list's pages. */
export async function fetchCourseFiles(
  courseId: string,
  signal?: AbortSignal,
): Promise<FilesItemList> {
  const items: FilesItemList['items'] = []
  let folders: FilesItemList['folders'] = []
  let cursor: string | null = null
  do {
    // oxlint-disable-next-line no-await-in-loop -- each page needs the previous page's cursor
    const { data }: { data: FilesItemList } = await filesItemList({
      path: { course_id: courseId },
      query: { recursive: true, limit: PAGE_SIZE, sort: 'name', cursor },
      signal,
      throwOnError: true,
    })
    folders = data.folders
    items.push(...data.items)
    cursor = data.next_cursor ?? null
  } while (cursor)
  return { folders, items, next_cursor: null }
}

/**
 * Everything in a course (all folders): folders are browsed on the client, which also gives the
 * name filter and the duplicate check the whole course without more requests.
 */
export function courseFilesOptions(courseId: string) {
  return queryOptions({
    queryKey: filesItemListQueryKey({ path: { course_id: courseId }, query: { recursive: true } }),
    queryFn: ({ signal }) => fetchCourseFiles(courseId, signal),
  })
}

export function useCourseFiles(courseId: string) {
  return useQuery({ ...courseFilesOptions(courseId), enabled: Boolean(courseId) })
}

/** The files page's data, started with its code (`PageContribution.prefetch`). */
export function prefetchFilesPage(
  scope: Scope,
  queryClient: QueryClient,
  { preload }: { preload: boolean },
) {
  if (scope.kind === 'course') {
    void queryClient.prefetchQuery(courseFilesOptions(scope.courseId))
    return
  }
  if (scope.kind !== 'term') return
  const { termId } = scope
  // A hovered link gets the course list only: every course's files wait for the click.
  if (preload) {
    void queryClient.prefetchQuery(courseListOptions(scope.programId, termId))
    return
  }
  queryClient
    .fetchQuery(courseListOptions(scope.programId, termId))
    .then((list) => {
      for (const course of coursesOfTerm(list.items, termId)) {
        void queryClient.prefetchQuery(courseFilesOptions(course.id))
      }
    })
    .catch(() => undefined)
}

export function useFileItem(itemId: string | null | undefined) {
  return useQuery({
    ...filesItemGetOptions({ path: { item_id: itemId ?? '' } }),
    enabled: Boolean(itemId),
  })
}

export function useFilesUsage() {
  return useQuery(filesUsageGetOptions())
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
