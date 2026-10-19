import type { Course, ItemOut } from '@semestra/api-client'
import { filesListOptions } from '@semestra/api-client/react-query'
import { useQueries } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { useId } from 'react'
import { courseColor, courseLabel } from '@/modules/academics/color'
import { coursesOfTerm, useCourse, useCourses } from '@/modules/academics/queries'
import { m } from '@/paraglide/messages'
import { Checkbox } from '@/ui/checkbox'
import { Field, FieldLabel, FieldLegend, FieldSet } from '@/ui/field'
import { Skeleton } from '@/ui/skeleton'
import type { QuickOpenSettings } from './quick-open'
import { FileIcon } from '../components/FileIcon'

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
  const termCourses = useCourses(params.programId ?? '', params.termId).data?.items
  const thisCourse = useCourse(params.courseId ?? '').data
  const courses: Course[] = params.courseId
    ? thisCourse
      ? [thisCourse]
      : []
    : coursesOfTerm(termCourses ?? [], params.termId ?? '')
  const lists = useQueries({
    queries: courses.map((course) => ({
      ...filesListOptions({
        path: { course_id: course.id },
        query: { recursive: true, limit: 500, sort: 'name' },
      }),
      staleTime: 30_000,
    })),
  })
  const selected = value.item_ids ?? []
  const toggle = (id: string, on: boolean) =>
    onChange({
      ...value,
      item_ids: on ? [...selected.filter((x) => x !== id), id] : selected.filter((x) => x !== id),
    })

  return (
    <div className="max-h-[50vh] space-y-4 overflow-y-auto">
      {courses.map((course, index) => (
        <PickerGroup
          key={course.id}
          course={course}
          showCourse={courses.length > 1}
          items={lists[index]?.data?.items}
          selected={selected}
          onToggle={toggle}
        />
      ))}
      {selected.length >= 24 ? (
        <p className="text-xs text-muted-foreground">{m.files_quick_open_limit()}</p>
      ) : null}
    </div>
  )
}

function PickerGroup({
  course,
  showCourse,
  items,
  selected,
  onToggle,
}: {
  course: Course
  showCourse: boolean
  items: ItemOut[] | undefined
  selected: readonly string[]
  onToggle: (id: string, on: boolean) => void
}) {
  const id = useId()
  return (
    <FieldSet className="gap-2">
      <FieldLegend variant="label" className="flex items-center gap-2">
        {showCourse ? (
          <span
            aria-hidden
            className="size-2.5 rounded-full"
            style={{ backgroundColor: courseColor(course) }}
          />
        ) : null}
        {showCourse ? courseLabel(course) : m.files_quick_open_choose()}
      </FieldLegend>
      {items === undefined ? (
        <Skeleton className="h-16 w-full" />
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{m.files_quick_open_no_files()}</p>
      ) : (
        items.map((item) => {
          const checked = selected.includes(item.id)
          return (
            <Field key={item.id} orientation="horizontal">
              <Checkbox
                id={`${id}-${item.id}`}
                checked={checked}
                disabled={!checked && selected.length >= 24}
                onCheckedChange={(on) => onToggle(item.id, on)}
              />
              <FieldLabel htmlFor={`${id}-${item.id}`} className="min-w-0 font-normal">
                <FileIcon
                  item={item}
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <span className="truncate">{item.display_name}</span>
              </FieldLabel>
            </Field>
          )
        })
      )}
    </FieldSet>
  )
}
