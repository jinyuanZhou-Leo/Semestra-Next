import { FolderOpen } from 'lucide-react'
import { formatBytes, formatDate } from '@/lib/format'
import { useCourseFiles } from '@/modules/files/queries'
import { m } from '@/paraglide/messages'
import { Checkbox } from '@/ui/checkbox'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/ui/field'
import { Skeleton } from '@/ui/skeleton'
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
  const query = useCourseFiles(courseId)
  const files = (query.data?.items ?? []).filter(readableCourseFile)
  if (query.isPending) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-14 rounded-2xl" />
        <Skeleton className="h-14 rounded-2xl" />
      </div>
    )
  }
  if (files.length === 0) {
    return (
      <Empty className="rounded-2xl border border-solid border-border p-6">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderOpen aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{m.imports_course_files_empty()}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      {files.map((file) => {
        const id = `import-course-file-${file.id}`
        const on = picked.includes(file.id)
        return (
          <FieldLabel
            key={file.id}
            htmlFor={id}
            className="*:data-[slot=field]:px-4 *:data-[slot=field]:py-3"
          >
            <Field
              orientation="horizontal"
              className="items-center has-[>[data-slot=field-content]]:items-center"
            >
              <Checkbox
                id={id}
                checked={on}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  onChange(checked ? [...picked, file.id] : picked.filter((p) => p !== file.id))
                }
              />
              <FieldContent className="min-w-0">
                <span className="truncate font-normal">{file.display_name}</span>
                <FieldDescription className="truncate text-xs">
                  {[formatBytes(file.size_bytes), formatDate(file.created_at)].join(' · ')}
                </FieldDescription>
              </FieldContent>
            </Field>
          </FieldLabel>
        )
      })}
    </div>
  )
}
