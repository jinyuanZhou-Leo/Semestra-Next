import { createFileRoute } from '@tanstack/react-router'
import { OVERVIEW_PAGE } from '@/app/host/nav'
import { installedModules, preloadPage } from '@/app/registry'
import { CourseView } from '@/modules/academics/shell/ScopeView'

export const Route = createFileRoute('/_authed/p/$programId/c/$courseId/')({
  loader: ({ context }) =>
    preloadPage('course', OVERVIEW_PAGE, installedModules(context.queryClient)),
  component: CourseOverview,
})

function CourseOverview() {
  const { programId, courseId } = Route.useParams()
  const { fromTerm } = Route.useSearch()
  return <CourseView key={courseId} programId={programId} courseId={courseId} fromTerm={fromTerm} />
}
