import type { PageProps } from '@/app/extensions'
import CourseFilesPage from './CourseFilesPage'
import TermFilesPage from './TermFilesPage'

/** The `files` page of a course or a term (M07 §6.1, §6.2). */
export default function FilesPage(props: PageProps) {
  return props.scope.kind === 'term' ? <TermFilesPage {...props} /> : <CourseFilesPage {...props} />
}
