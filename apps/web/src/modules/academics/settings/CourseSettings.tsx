import type { Course, CourseUpdateInputBody, Instructor, Term } from '@semestra/api-client'
import {
  academicsCourseSetTermsMutation,
  academicsCourseUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { SettingsSectionProps } from '@/app/extensions'
import { DangerZone, useAutosave } from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { SettingList } from '@/components/SettingRow'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Input } from '@/ui/input'
import { Switch } from '@/ui/switch'
import { ColorPicker, type ColorRef } from '../components/ColorPicker'
import { DeleteCourseDialog } from '../components/DeleteCourseDialog'
import { invalidateAcademics, useCourse, useTerms } from '../queries'
import { ControlRow, NumberRow, TextRow } from './rows'

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
  const [deleting, setDeleting] = useState(false)
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
      <SettingList>
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
        <ControlRow
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
        </ControlRow>
        <ControlRow label={m.academics_course_color()}>
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
        </ControlRow>
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
        <div className="space-y-2 p-4">
          <p className="text-sm font-medium">{m.academics_course_instructors()}</p>
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
                variant="ghost"
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
        </div>
      </SettingList>

      <h3 className="pt-2 font-heading text-base font-medium">{m.academics_course_terms()}</h3>
      <SettingList>
        <ControlRow
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
        </ControlRow>
        <fieldset className="space-y-1.5 p-4">
          <legend className="sr-only">{m.academics_course_terms()}</legend>
          {terms.map((term) => {
            const checked = termIds.includes(term.id)
            return (
              <label key={term.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={checked}
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
                {term.name}
              </label>
            )
          })}
          {termsInvalid ? (
            <p role="alert" className="text-xs text-destructive">
              {m.error_academics_course_terms_not_adjacent()}
            </p>
          ) : null}
        </fieldset>
      </SettingList>

      <DangerZone>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">{m.academics_course_delete_description()}</p>
          <Button variant="destructive" onClick={() => setDeleting(true)}>
            {m.academics_course_delete()}
          </Button>
        </div>
      </DangerZone>
      <DeleteCourseDialog course={course} open={deleting} onOpenChange={setDeleting} />
    </>
  )
}
