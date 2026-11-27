import { createElement } from 'react'
import type { SettingsSectionProps } from '@/app/extensions'
import { CourseLmsSection as Real } from './CourseLmsSection'
import { CourseSuggestionSample, CourseUnboundSample } from './Samples'
export { ConnectionsSection } from './ConnectionsSection'
export { MaterialsSection } from './MaterialsSection'
export { ProgramConnectionSample as ProgramLmsSection, ProgramCoursesSample } from './Samples'
export function CourseLmsSection(props: SettingsSectionProps) {
  const s = new URLSearchParams(window.location.search).get('sample')
  if (s === 'suggest') return createElement(CourseSuggestionSample, props)
  if (s === 'picker') return createElement(CourseSuggestionSample, { ...props, open: true })
  if (s === 'unbound') return createElement(CourseUnboundSample, props)
  return createElement(Real, props)
}
