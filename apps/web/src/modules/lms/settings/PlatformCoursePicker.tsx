import type { ExternalCourse } from '@semestra/api-client'
import { lmsCourseListOptions } from '@semestra/api-client/react-query'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
  ComboboxTrigger,
} from '@/ui/combobox'
import { Field, FieldLabel } from '@/ui/field'
import { Switch } from '@/ui/switch'
import { groupByTerm } from '../external'
import { useProviderName } from '../providers'
import { codeMatches } from './suggest'

export type PickerGroup = { id: string; label: string; items: ExternalCourse[] }

/**
 * The picker's groups (M09 §7.1): the courses whose code matches this course's, from every term
 * (`everything`, past ones too), then the shown courses by term, then the ones another course
 * links to, which cannot be picked and come last. A course is listed once.
 */
export function pickerGroups(
  items: readonly ExternalCourse[],
  courseCode: string | null | undefined,
  courseId: string,
  currentId?: string,
  everything: readonly ExternalCourse[] = items,
): PickerGroup[] {
  const elsewhere = (c: ExternalCourse) =>
    Boolean(c.linked_course_id && c.linked_course_id !== courseId)
  const suggested = everything.filter(
    (c) => codeMatches(courseCode, c) && c.external_id !== currentId && !elsewhere(c),
  )
  const shown = new Set(suggested.map((c) => c.external_id))
  const rest = items.filter((c) => !shown.has(c.external_id))
  const groups: PickerGroup[] = suggested.length
    ? [{ id: 'suggested', label: m.lms_course_suggested(), items: suggested }]
    : []
  for (const group of groupByTerm(rest.filter((c) => !elsewhere(c)))) {
    groups.push({ id: group.term, label: group.term, items: group.courses })
  }
  const taken = rest.filter(elsewhere)
  if (taken.length) groups.push({ id: 'taken', label: m.lms_course_taken(), items: taken })
  return groups
}

/**
 * One searchable list of the platform's courses for one course. Picking a course calls `onPick`
 * (only a press on an item: typing on the closed trigger also selects, as typeahead).
 */
export function PlatformCoursePicker({
  programId,
  courseId,
  courseCode,
  currentId,
  disabled,
  onPick,
  labelId,
  className,
}: {
  programId: string
  courseId: string
  courseCode: string | null | undefined
  /** The course it links to now: disabled in the list. */
  currentId?: string
  disabled?: boolean
  onPick: (course: ExternalCourse) => void
  /** The visible name of the picker. */
  labelId?: string
  className?: string
}) {
  const pastId = useId()
  const [past, setPast] = useState(false)
  // Keeps the list while "Show past courses" refetches, so the list does not jump.
  const courses = useQuery({
    ...lmsCourseListOptions({ path: { program_id: programId }, query: { include_past: past } }),
    placeholderData: keepPreviousData,
  })
  // Suggestions come from every term: a course's match may be in a term not current yet.
  const all = useQuery(
    lmsCourseListOptions({ path: { program_id: programId }, query: { include_past: true } }),
  )
  const provider = useProviderName(courses.data?.provider) ?? m.lms_name()
  const items = courses.data?.items ?? []
  const groups = pickerGroups(items, courseCode, courseId, currentId, all.data?.items ?? items)

  return (
    <Combobox
      items={groups}
      value={null}
      onValueChange={(chosen: ExternalCourse | null, details) => {
        if (chosen && details.reason === 'item-press') onPick(chosen)
      }}
      itemToStringLabel={(c: ExternalCourse) => `${c.code ?? ''} ${c.name}`}
      isItemEqualToValue={(a: ExternalCourse, b: ExternalCourse) => a.external_id === b.external_id}
      disabled={disabled}
    >
      <ComboboxTrigger
        aria-labelledby={labelId}
        render={
          <Button variant="outline" className={cn('justify-between font-normal', className)} />
        }
      >
        <span className="truncate text-muted-foreground">{m.lms_course_pick_placeholder()}</span>
      </ComboboxTrigger>
      <ComboboxContent align="end" className="w-96">
        <ComboboxInput showTrigger={false} placeholder={m.lms_course_search()} />
        <ComboboxEmpty>
          {courses.isPending
            ? m.common_loading()
            : items.length === 0
              ? m.lms_courses_empty({ provider })
              : m.lms_course_search_empty()}
        </ComboboxEmpty>
        <ComboboxList>
          {(group: PickerGroup) => (
            <ComboboxGroup key={group.id} items={group.items}>
              {group === groups[0] ? null : <ComboboxSeparator />}
              <ComboboxLabel>{group.label}</ComboboxLabel>
              <ComboboxCollection>
                {(c: ExternalCourse) => (
                  <CourseOption
                    key={c.external_id}
                    course={c}
                    courseId={courseId}
                    currentId={currentId}
                  />
                )}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
        <Field orientation="horizontal" className="border-t px-3 py-2">
          <Switch size="sm" id={pastId} checked={past} onCheckedChange={setPast} />
          <FieldLabel htmlFor={pastId} className="text-xs font-normal text-muted-foreground">
            {m.lms_show_past()}
          </FieldLabel>
        </Field>
      </ComboboxContent>
    </Combobox>
  )
}

/** Code over name; the current one, or one linked by another course, is disabled and says so. */
function CourseOption({
  course,
  courseId,
  currentId,
}: {
  course: ExternalCourse
  courseId: string
  currentId?: string
}) {
  const elsewhere = Boolean(course.linked_course_id && course.linked_course_id !== courseId)
  const isCurrent = course.external_id === currentId
  return (
    <ComboboxItem value={course} disabled={elsewhere || isCurrent}>
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{course.code ?? course.name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {isCurrent
            ? m.lms_course_current()
            : elsewhere
              ? m.lms_course_linked_to({ course: course.linked_course_name ?? '' })
              : [course.code ? course.name : null, course.term].filter(Boolean).join(' · ')}
        </span>
      </span>
    </ComboboxItem>
  )
}
