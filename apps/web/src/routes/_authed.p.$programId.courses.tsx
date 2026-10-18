import { createFileRoute } from '@tanstack/react-router'
import { AllCoursesPage } from '@/modules/academics/pages/AllCoursesPage'

export const Route = createFileRoute('/_authed/p/$programId/courses')({ component: AllCourses })

function AllCourses() {
  const { programId } = Route.useParams()
  return <AllCoursesPage programId={programId} />
}
