import type { PageProps } from '@/app/extensions'
import { PluginBoundary } from '@/app/host/PluginBoundary'
import { useExtensions } from '@/app/registry'
import { MOBILE_OVERVIEW_SECTIONS, type MobileOverviewSection } from '../types'

/**
 * A course's overview on a phone (M17 §4.1): one column of what other modules contribute in
 * place of the desktop board's cards (classes this week, the grade, tasks, the platform).
 */
export default function CourseOverviewMobile({ scope }: PageProps) {
  const sections = useExtensions<MobileOverviewSection>(MOBILE_OVERVIEW_SECTIONS).toSorted(
    (a, b) => a.order - b.order,
  )
  if (scope.kind !== 'course') return null
  return sections.map((section) => (
    <PluginBoundary key={section.id}>
      <section.component programId={scope.programId} courseId={scope.courseId} />
    </PluginBoundary>
  ))
}
