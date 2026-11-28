import { filesItemSearchOptions } from '@semestra/api-client/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { Scope, SearchResult } from '@/app/extensions'
import { courseLabel } from '@/modules/academics/color'
import { courseListOptions } from '@/modules/academics/queries'
import { fileIcon } from './kinds'
import { filePath } from './location'

const MAX_RESULTS = 5

/**
 * The command palette's files: the Program's whose name contains the words, most recently changed
 * first. One opens its preview on its course's files page, in its folder.
 */
export async function searchFiles(
  query: string,
  scope: Scope | undefined,
  queryClient: QueryClient,
): Promise<SearchResult[]> {
  if (!scope) return []
  const { programId } = scope
  const [found, courses] = await Promise.all([
    queryClient.fetchQuery(
      filesItemSearchOptions({
        path: { program_id: programId },
        query: { query, limit: MAX_RESULTS },
      }),
    ),
    queryClient.ensureQueryData(courseListOptions(programId)),
  ])
  const labels = new Map(courses.items.map((c) => [c.id, courseLabel(c)]))
  return found.items.map((file) => ({
    id: file.id,
    title: file.display_name,
    subtitle: labels.get(file.course_id),
    icon: fileIcon({ kind: 'file', mime_type: file.mime_type }),
    to: filePath(programId, file),
  }))
}
