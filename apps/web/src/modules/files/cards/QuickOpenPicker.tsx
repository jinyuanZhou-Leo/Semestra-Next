import { academicsCourseListOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { coursesOfTerm } from '@/modules/academics/queries'
import { m } from '@/paraglide/messages'
import type { QuickOpenSettings } from './quick-open'
import { FilePicker } from '../components/FilePicker'

/** The most files the card shows (its schema's limit). */
const MAX = 24

/**
 * The card's settings: tick files from the course, or from every course of the term. The host
 * does not pass the scope to settings forms, so it is read from the page's address.
 */
export function QuickOpenPicker({
  value,
  onChange,
}: {
  value: QuickOpenSettings
  onChange: (value: QuickOpenSettings) => void
}) {
  const params = useParams({ strict: false }) as {
    programId?: string
    termId?: string
    courseId?: string
  }
  // On a course page only that course is needed; on a term page, the term's courses.
  const onCourse = Boolean(params.courseId)
  const onTerm = !onCourse && Boolean(params.programId) && Boolean(params.termId)
  const termList = useQuery({
    ...academicsCourseListOptions({
      path: { program_id: params.programId ?? '' },
      query: { limit: 500, term_id: params.termId },
    }),
    enabled: onTerm,
  })
  const courses = onTerm ? coursesOfTerm(termList.data?.items ?? [], params.termId ?? '') : []
  const selected = value.item_ids ?? []
  return (
    <div className="flex flex-col gap-2">
      <FilePicker
        courseId={params.courseId}
        courses={courses}
        selected={selected}
        max={MAX}
        onChange={(item_ids) => onChange({ ...value, item_ids })}
        emptyTitle={m.files_quick_open_no_files()}
        className="h-80"
      />
      {selected.length >= MAX ? (
        <p className="text-xs text-muted-foreground">{m.files_quick_open_limit()}</p>
      ) : null}
    </div>
  )
}
