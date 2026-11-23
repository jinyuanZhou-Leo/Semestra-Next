import { createFileRoute } from '@tanstack/react-router'
import { preloadPage } from '@/app/registry'
import { pageSearch } from '@/lib/page-search'
import { CourseView } from '@/modules/academics/shell/ScopeView'

/** Other string search params belong to the page itself (e.g. the Canvas tab's location, M16). */
export const Route = createFileRoute('/_authed/p/$programId/c/$courseId/$page')({
  validateSearch: pageSearch,
  loader: ({ context, params, preload, location }) =>
    preloadPage(
      { kind: 'course', programId: params.programId, courseId: params.courseId },
      params.page,
      context.queryClient,
      // The Canvas tab opens where the link points (`?tab=&ref=`, M16).
      { preload, search: location.search },
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
