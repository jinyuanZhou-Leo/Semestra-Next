import type { PageProps } from '@/app/extensions'
import CourseGradesPage from './CourseGradesPage'
import TermGradesPage from './TermGradesPage'

/** The `grades` page of a course or a term (M03 §5.1, §5.2). */
export default function GradesPage(props: PageProps) {
  return props.scope.kind === 'term' ? (
    <TermGradesPage {...props} />
  ) : (
    <CourseGradesPage {...props} />
  )
}
