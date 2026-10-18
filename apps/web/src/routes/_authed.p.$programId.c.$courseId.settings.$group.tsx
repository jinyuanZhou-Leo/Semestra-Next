import { createFileRoute } from '@tanstack/react-router'
import { scopePath, scopeSettingsPath } from '@/app/extensions'
import { SettingsPage } from '@/app/settings'
import { courseLabel } from '@/modules/academics/color'
import { useCourse } from '@/modules/academics/queries'
import { m } from '@/paraglide/messages'

export const Route = createFileRoute('/_authed/p/$programId/c/$courseId/settings/$group')({
  component: CourseSettings,
})

function CourseSettings() {
  const { programId, courseId, group } = Route.useParams()
  const scope = { kind: 'course', programId, courseId } as const
  const course = useCourse(courseId).data
  return (
    <SettingsPage
      key={courseId}
      level="course"
      scope={scope}
      groupId={group}
      title={course ? courseLabel(course) : m.settings_title()}
      hrefFor={(id) => scopeSettingsPath(scope, id)}
      fallbackHref={scopePath(scope)}
    />
  )
}
