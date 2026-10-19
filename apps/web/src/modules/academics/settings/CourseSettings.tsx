import type { Course, CourseUpdateInputBody, Instructor, Term } from '@semestra/api-client'
import {
  academicsCourseSetTermsMutation,
  academicsCourseUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import type { SettingsSectionProps } from '@/app/extensions'
import {
  DangerZone,
  NumberRow,
  SettingRow,
  SettingsBlock,
  SettingsGroup,
  TextRow,
  useAutosave,
} from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Field, FieldError, FieldLabel, FieldLegend, FieldSet } from '@/ui/field'
import { Input } from '@/ui/input'
import { Item, ItemContent, ItemTitle } from '@/ui/item'
import { Switch } from '@/ui/switch'
import { ColorPicker, type ColorRef } from '../components/ColorPicker'
import { DeleteCourseDialog } from '../components/DeleteCourseDialog'
import { invalidateAcademics, useCourse, useTerms } from '../queries'

/** Whether the chosen terms are neighbours in the Program's order (M02 §3, year-long courses). */
export function areConsecutive(terms: readonly Term[], ids: readonly string[]): boolean {
  const positions = ids.map((id) => terms.findIndex((t) => t.id === id)).toSorted((a, b) => a - b)
  if (positions.length === 0 || positions[0] === -1) return false
  return positions.every((p, i) => i === 0 || p === (positions[i - 1] ?? 0) + 1)
}

/** Course "basics" (M02 §5.5): every field, its color, its terms (year-long), delete. */
export function CourseBasicsSection({ scope }: SettingsSectionProps) {
  const courseId = scope?.kind === 'course' ? scope.courseId : ''
  const terms = useTerms(scope?.programId ?? '')
  return (
    <AsyncBoundary query={useCourse(courseId)}>
      {(course) => <CourseBasics key={course.id} course={course} terms={terms.data?.items ?? []} />}
    </AsyncBoundary>
  )
}

function CourseBasics({ course, terms }: { course: Course; terms: Term[] }) {
  const id = useId()
  const queryClient = useQueryClient()
  const update = useMutation({ ...academicsCourseUpdateMutation() })
  const setTerms = useMutation({
    ...academicsCourseSetTermsMutation(),
    onError: toastError,
    onSuccess: () => invalidateAcademics(queryClient),
  })
  const { queue } = useAutosave<CourseUpdateInputBody>({
    save: async (body) => {
      try {
        await update.mutateAsync({ path: { course_id: course.id }, body })
      } catch (error) {
        toastError(error)
        throw error
      }
      await invalidateAcademics(queryClient)
    },
  })
  const [color, setColor] = useState<ColorRef | null>(course.color)
  const [includeInGpa, setIncludeInGpa] = useState(course.include_in_gpa)
  const [instructors, setInstructors] = useState<Instructor[]>(course.instructors)
  const [yearLong, setYearLong] = useState(course.planned_terms > 1)
  const [termIds, setTermIds] = useState<string[]>(course.term_ids)
  const termsInvalid = !areConsecutive(terms, termIds)

  const chooseTerms = (next: string[]) => {
    setTermIds(next)
    if (areConsecutive(terms, next))
      setTerms.mutate({ path: { course_id: course.id }, body: { term_ids: next } })
  }
  const changeInstructors = (next: Instructor[]) => {
    setInstructors(next)
    queue({ instructors: next.filter((person) => person.name.trim()) })
  }

  return (
    <>
      <SettingsGroup>
        <TextRow
          label={m.academics_course_code()}
          value={course.code ?? ''}
          placeholder="APS105H1"
          onChange={(text) => queue({ code: text.trim() || null })}
        />
        <TextRow
          label={m.academics_course_title()}
          value={course.title}
          required
          onChange={(title) => queue({ title })}
        />
        <TextRow
          label={m.academics_course_alias()}
          description={m.academics_course_alias_hint()}
          value={course.alias ?? ''}
          onChange={(text) => queue({ alias: text.trim() || null })}
        />
        <TextRow
          label={m.academics_course_subject()}
          description={m.academics_course_subject_hint()}
          value={course.subject_code}
          onChange={(text) => queue({ subject_code: text.trim().toUpperCase() })}
        />
        <NumberRow
          label={m.academics_course_credits()}
          value={course.credits}
          max={100}
          onChange={(value) => value !== null && queue({ credits: value })}
        />
        <SettingRow
          label={m.academics_course_in_gpa()}
          description={m.academics_course_in_gpa_hint()}
        >
          {(labelId) => (
            <Switch
              aria-labelledby={labelId}
              checked={includeInGpa}
              onCheckedChange={(on) => {
                setIncludeInGpa(on)
                queue({ include_in_gpa: on })
              }}
            />
          )}
        </SettingRow>
        <SettingRow label={m.academics_course_color()}>
          {() => (
            <ColorPicker
              label={m.academics_course_color()}
              inheritLabel={m.academics_color_use_subject()}
              value={color}
              onChange={(next) => {
                setColor(next)
                queue({ color: next })
              }}
            />
          )}
        </SettingRow>
        <TextRow
          label={m.academics_course_website()}
          type="url"
          value={course.website_url ?? ''}
          placeholder="https://"
          onChange={(text) => queue({ website_url: text.trim() || null })}
        />
        <TextRow
          label={m.academics_course_description()}
          multiline
          value={course.description ?? ''}
          onChange={(text) => queue({ description: text.trim() || null })}
        />
        <Item>
          <ItemContent className="gap-2">
            <ItemTitle>{m.academics_course_instructors()}</ItemTitle>
            {instructors.map((person, index) => (
              // Instructors have no ids; their position identifies them while editing.
              // oxlint-disable-next-line react/no-array-index-key
              <div key={index} className="flex flex-wrap items-center gap-2">
                <Input
                  aria-label={m.academics_instructor_name()}
                  placeholder={m.academics_instructor_name()}
                  className="w-48"
                  value={person.name}
                  onChange={(event) =>
                    changeInstructors(
                      instructors.map((p, i) =>
                        i === index ? { ...p, name: event.target.value } : p,
                      ),
                    )
                  }
                />
                <Input
                  type="email"
                  aria-label={m.academics_instructor_email()}
                  placeholder={m.academics_instructor_email()}
                  className="w-56"
                  value={person.email ?? ''}
                  onChange={(event) =>
                    changeInstructors(
                      instructors.map((p, i) =>
                        i === index ? { ...p, email: event.target.value.trim() || null } : p,
                      ),
                    )
                  }
                />
                <Button
                  variant="destructive"
                  size="icon-sm"
                  aria-label={m.academics_instructor_remove({
                    name: person.name || m.academics_instructor_name(),
                  })}
                  onClick={() => changeInstructors(instructors.filter((_, i) => i !== index))}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setInstructors([...instructors, { name: '' }])}
            >
              <Plus aria-hidden />
              {m.academics_instructor_add()}
            </Button>
          </ItemContent>
        </Item>
      </SettingsGroup>

      <SettingsBlock title={m.academics_course_terms()}>
        <SettingsGroup>
          <SettingRow
            label={m.academics_course_year_long()}
            description={m.academics_course_year_long_hint()}
          >
            {(labelId) => (
              <Switch
                aria-labelledby={labelId}
                checked={yearLong}
                onCheckedChange={(on) => {
                  setYearLong(on)
                  queue({ planned_terms: on ? Math.max(2, termIds.length) : 1 })
                  if (!on && termIds.length > 1) chooseTerms(termIds.slice(0, 1))
                }}
              />
            )}
          </SettingRow>
          <Item>
            <FieldSet className="gap-1.5">
              <FieldLegend className="sr-only">{m.academics_course_terms()}</FieldLegend>
              {terms.map((term) => (
                <Field key={term.id} orientation="horizontal">
                  <Checkbox
                    id={`${id}-${term.id}`}
                    checked={termIds.includes(term.id)}
                    onCheckedChange={(on) => {
                      if (!yearLong) {
                        if (on) chooseTerms([term.id])
                        return
                      }
                      const next = on
                        ? [...termIds, term.id]
                        : termIds.filter((tid) => tid !== term.id)
                      if (next.length > 0) chooseTerms(next)
                    }}
                  />
                  <FieldLabel htmlFor={`${id}-${term.id}`} className="font-normal">
                    {term.name}
                  </FieldLabel>
                </Field>
              ))}
              <FieldError className="text-xs">
                {termsInvalid ? m.error_academics_course_terms_not_adjacent() : null}
              </FieldError>
            </FieldSet>
          </Item>
        </SettingsGroup>
      </SettingsBlock>
    </>
  )
}

/** Delete the course, at the end of its general settings. */
export function CourseDangerSection({ scope }: SettingsSectionProps) {
  const courseId = scope?.kind === 'course' ? scope.courseId : ''
  return (
    <AsyncBoundary query={useCourse(courseId)}>
      {(course) => <CourseDanger key={course.id} course={course} />}
    </AsyncBoundary>
  )
}

function CourseDanger({ course }: { course: Course }) {
  const [deleting, setDeleting] = useState(false)
  return (
    <>
      <DangerZone>
        <SettingRow
          label={m.academics_course_delete()}
          description={m.academics_course_delete_description()}
        >
          <Button variant="destructive" onClick={() => setDeleting(true)}>
            {m.common_delete()}
          </Button>
        </SettingRow>
      </DangerZone>
      <DeleteCourseDialog course={course} open={deleting} onOpenChange={setDeleting} />
    </>
  )
}
