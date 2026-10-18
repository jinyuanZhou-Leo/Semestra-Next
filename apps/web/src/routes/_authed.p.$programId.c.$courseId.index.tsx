import { createFileRoute } from '@tanstack/react-router'
import { CourseView } from '@/modules/academics/shell/ScopeView'

export const Route = createFileRoute('/_authed/p/$programId/c/$courseId/')({
  component: CourseOverview,
})

function CourseOverview() {
  const { programId, courseId } = Route.useParams()
  const { fromTerm } = Route.useSearch()
  return <CourseView key={courseId} programId={programId} courseId={courseId} fromTerm={fromTerm} />
}
