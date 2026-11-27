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
  disabled,
  onChange,
}: {
  courseId: string
  picked: readonly string[]
  disabled?: boolean
  onChange: (picked: string[]) => void
}) {
  return (
    <FilePicker
      courseId={courseId}
      selected={picked}
      onChange={onChange}
      disabled={disabled}
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
