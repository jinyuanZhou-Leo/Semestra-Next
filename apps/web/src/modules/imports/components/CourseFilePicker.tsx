import { useQuery } from '@tanstack/react-query'
import { academicsCourseGetOptions } from '@semestra/api-client/react-query'
import { formatDate } from '@/lib/format'
import { FilePicker } from '@/modules/files/components/FilePicker'
import { m } from '@/paraglide/messages'
import { readableCourseFile } from '../sources'

/**
 * "From course files": the course's readable files to tick. Picking a file the import reads what
 * M07 already parsed, so nothing is uploaded again.
 */
export function CourseFilePicker({
  courseId,
  picked,
  onChange,
}: {
  courseId: string
  picked: readonly string[]
  disabled?: boolean
  onChange: (picked: string[]) => void
}) {
  const course = useQuery(academicsCourseGetOptions({ path: { course_id: courseId } })).data
  return (
    <FilePicker
      courses={course ? [course] : []}
      selected={picked}
      onChange={onChange}
      filter={readableCourseFile}
      meta={(file) =>
        file.doc_status === 'pending' || file.doc_status === 'processing'
          ? m.files_status_processing()
          : file.doc_status === 'none'
            ? m.imports_file_not_indexed()
            : formatDate(file.created_at, { short: true })
      }
      emptyTitle={m.imports_course_files_empty()}
      className="h-full"
    />
  )
}
