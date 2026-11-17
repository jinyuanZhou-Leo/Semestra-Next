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
import type { Target } from './folders'
import { prefetchCourseWeeks } from './weeks'

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
    prefetchCourseWeeks(queryClient, scope.programId, scope.courseId).catch(() => undefined)
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
        prefetchCourseWeeks(queryClient, scope.programId, course.id).catch(() => undefined)
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

type FilesKey = { _id?: unknown; path?: { course_id?: unknown } }

/**
 * Refetch what a change to one course's files made from this tab can affect: that course's
 * list, and the file, search and storage queries (other courses' lists stay).
 */
export function invalidateFiles(queryClient: QueryClient, courseId: string) {
  return queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey[0] as FilesKey | undefined
      // oxlint-disable-next-line no-underscore-dangle -- hey-api's query key field
      const id = String(key?._id ?? '')
      if (id === 'filesItemList') return key?.path?.course_id === courseId
      return id.startsWith('files')
    },
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

/** Files and folders one zip is asked for by id (they go in its address; `week` has no limit). */
export const DOWNLOAD_MAX = 300

/**
 * Where to download the chosen files and folders: one file as it is, anything more as a zip.
 * `week`: they are every file of that week (or `term`), asked for as such. Null when there is
 * nothing to download (only links).
 */
export function downloadUrl(
  courseId: string,
  targets: readonly Target[],
  week?: string,
): string | null {
  const items = targets.flatMap((t) =>
    t.type === 'item' && t.item.kind === 'file' ? [t.item] : [],
  )
  const folders = targets.flatMap((t) => (t.type === 'folder' ? [t.folder.id] : []))
  const [only] = items
  if (only && items.length === 1 && folders.length === 0) return contentUrl(only.id, 'attachment')
  if (items.length === 0 && folders.length === 0) return null
  return client.buildUrl({
    url: '/courses/{course_id}/files:download',
    path: { course_id: courseId },
    query: week ? { week } : { item_ids: items.map((i) => i.id), folder_ids: folders },
  })
}

/** A small picture of one page of a processed file (only when `doc_status` is ready). */
export function pageImageUrl(itemId: string, page: number) {
  return client.buildUrl({
    url: '/files/{item_id}/pages/{page}.png',
    path: { item_id: itemId, page },
  })
}
