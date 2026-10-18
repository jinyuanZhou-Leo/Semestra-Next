import { createFileRoute } from '@tanstack/react-router'
import { CourseView } from '@/modules/academics/shell/ScopeView'

export const Route = createFileRoute('/_authed/p/$programId/c/$courseId/$page')({
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
