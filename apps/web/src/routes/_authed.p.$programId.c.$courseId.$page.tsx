import { createFileRoute } from '@tanstack/react-router'
import { preloadPage } from '@/app/registry'
import { CourseView } from '@/modules/academics/shell/ScopeView'

/** Other string search params belong to the page itself (e.g. the Canvas tab's location, M16). */
export const Route = createFileRoute('/_authed/p/$programId/c/$courseId/$page')({
  validateSearch: (search: Record<string, unknown>): Record<string, string> =>
    Object.fromEntries(
      Object.entries(search).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    ),
  loader: ({ context, params, preload }) =>
    preloadPage(
      { kind: 'course', programId: params.programId, courseId: params.courseId },
      params.page,
      context.queryClient,
      { preload },
    ),
  component: CoursePage,
})

function CoursePage() {
  const { programId, courseId, page } = Route.useParams()
  const { fromTerm } = Route.useSearch()
  return (
    <CourseView
      key={`${courseId}:${page}`}
      programId={programId}
      courseId={courseId}
      pageId={page}
      fromTerm={fromTerm}
    />
  )
}
