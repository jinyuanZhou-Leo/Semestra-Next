import { academicsCourseGetOptions } from '@semestra/api-client/react-query'
import { Outlet, createFileRoute } from '@tanstack/react-router'

/** Course pages: `?fromTerm=` tells the breadcrumb which term the user came from (M02 §5.5). */
export const Route = createFileRoute('/_authed/p/$programId/c/$courseId')({
  validateSearch: (search: Record<string, unknown>): { fromTerm?: string } =>
    typeof search.fromTerm === 'string' ? { fromTerm: search.fromTerm } : {},
  // Every course page starts from the course; fetch it alongside the page's code.
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      academicsCourseGetOptions({ path: { course_id: params.courseId } }),
    )
  },
  component: Outlet,
})
