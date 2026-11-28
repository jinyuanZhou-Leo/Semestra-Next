import { gradingAssessmentFindOptions } from '@semestra/api-client/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { Scope, SearchResult } from '@/app/extensions'
import { coursePath } from '@/modules/academics/paths'
import { courseLabel } from '@/modules/academics/color'
import { courseListOptions } from '@/modules/academics/queries'
import { formatDate } from '@/lib/format'

const MAX_RESULTS = 5

/**
 * The command palette's assessments: the Program's, the current term's courses first. One opens
 * its row in the course's gradebook (`?assessment=`).
 */
export async function searchAssessments(
  query: string,
  scope: Scope | undefined,
  queryClient: QueryClient,
): Promise<SearchResult[]> {
  if (!scope) return []
  const { programId } = scope
  const [found, courses] = await Promise.all([
    queryClient.fetchQuery(
      gradingAssessmentFindOptions({
        path: { program_id: programId },
        query: { query, limit: MAX_RESULTS },
      }),
    ),
    queryClient.ensureQueryData(courseListOptions(programId)),
  ])
  const labels = new Map(courses.items.map((c) => [c.id, courseLabel(c)]))
  return found.items.map((a) => ({
    id: a.id,
    title: a.title,
    subtitle: [
      labels.get(a.course_id) ?? a.course_code ?? a.course_title,
      a.category_name,
      a.due_at ? formatDate(a.due_at, { short: true }) : null,
    ]
      .filter(Boolean)
      .join(' · '),
    to: `${coursePath(programId, a.course_id, 'grades')}?assessment=${encodeURIComponent(a.id)}`,
  }))
}
