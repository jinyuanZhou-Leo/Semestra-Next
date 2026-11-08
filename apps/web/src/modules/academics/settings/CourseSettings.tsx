import {
  academicsCourseSetTerms,
  academicsCourseUpdate,
  type Course,
  type CourseUpdateInputBody,
  type Instructor,
  type Term,
} from '@semestra/api-client'
import {
  academicsCourseGetQueryKey,
  academicsCourseUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { createColumnHelper } from '@tanstack/react-table'
import { createContext, use, useState } from 'react'
import type { SettingsSectionProps } from '@/app/extensions'
import {
  DangerZone,
  NumberRow,
  SettingRow,
  SettingsBlock,
  SettingsGroup,
  SettingsTable,
  settingsTableFeatures,
  TextRow,
  useAutosave,
} from '@/app/settings'
import { useExtensions } from '@/app/registry'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { ChoiceControl } from '@/app/settings/choice'
import { toastError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { subjectColor } from '@/lib/subject-color'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Empty, EmptyHeader, EmptyTitle } from '@/ui/empty'
import { Switch } from '@/ui/switch'
import { ColorPicker, type ColorRef } from '../components/ColorPicker'
import { DeleteCourseDialog } from '../components/DeleteCourseDialog'
import { invalidateAcademics, useCourse, useTerms } from '../queries'
import { endChoices, NEXT_TERM, rangeOf, rangeTerms, spanFrom } from '../term-range'
import { COURSE_INFO_FILLS, type CourseInfoFill } from '../types'

/** An instructor with its position; instructors have no ids, their place identifies them. */
type InstructorLine = { index: number; person: Instructor }

// The cells live at module level and read the list from this context, so typing keeps focus.
const InstructorsContext = createContext<{
  instructors: Instructor[]
  change: (next: Instructor[]) => void
} | null>(null)

function useInstructors() {
  const state = use(InstructorsContext)
  if (!state) throw new Error('instructor cells must render inside the instructors table')
  const { instructors, change } = state
  return {
    patch: (index: number, patch: Partial<Instructor>) =>
      change(instructors.map((p, i) => (i === index ? { ...p, ...patch } : p))),
    remove: (index: number) => change(instructors.filter((_, i) => i !== index)),
  }
}

function InstructorNameCell({ line }: { line: InstructorLine }) {
  const { patch } = useInstructors()
  return (
    <Input
      aria-label={m.academics_instructor_name()}
      placeholder={m.academics_instructor_name()}
      className="w-full"
      value={line.person.name}
      onChange={(event) => patch(line.index, { name: event.target.value })}
    />
  )
}

function InstructorEmailCell({ line }: { line: InstructorLine }) {
  const { patch } = useInstructors()
  return (
    <Input
      type="email"
      aria-label={m.academics_instructor_email()}
      placeholder={m.academics_instructor_email()}
      className="w-full"
      value={line.person.email ?? ''}
      onChange={(event) => patch(line.index, { email: event.target.value.trim() || null })}
    />
  )
}

function InstructorRemoveCell({ line }: { line: InstructorLine }) {
  const { remove } = useInstructors()
  return (
    <Button
      variant="destructive"
      size="icon-sm"
      aria-label={m.academics_instructor_remove({
        name: line.person.name || m.academics_instructor_name(),
      })}
      onClick={() => remove(line.index)}
    >
      <Trash2 aria-hidden />
    </Button>
  )
}

const instructorColumn = createColumnHelper<typeof settingsTableFeatures, InstructorLine>()
const instructorColumns = instructorColumn.columns([
  instructorColumn.display({
    id: 'name',
    header: () => m.academics_instructor_name(),
    cell: ({ row }) => <InstructorNameCell line={row.original} />,
  }),
  instructorColumn.display({
    id: 'email',
    header: () => m.academics_instructor_email(),
    cell: ({ row }) => <InstructorEmailCell line={row.original} />,
  }),
  instructorColumn.display({
    id: 'remove',
    header: () => <span className="sr-only">{m.common_remove()}</span>,
    cell: ({ row }) => <InstructorRemoveCell line={row.original} />,
  }),
])
const INSTRUCTOR_COLUMN_CLASS = {
  name: 'w-full max-w-0 pl-2',
  email: 'w-64 min-w-64',
  remove: 'w-14 min-w-14',
}

/** Course "basics" (M02 §5.5): every field, its color, its terms (year-long), delete. */
export function CourseBasicsSection({ scope }: SettingsSectionProps) {
  const courseId = scope?.kind === 'course' ? scope.courseId : ''
  const terms = useTerms(scope?.programId ?? '')
  const fills = useExtensions<CourseInfoFill>(COURSE_INFO_FILLS)
  // Bumped when a fill changed the course: the fields keep what was typed, so they start over.
  const [revision, setRevision] = useState(0)
  return (
    <AsyncBoundary query={useCourse(courseId)}>
      {(course) => (
        <>
          {fills.map((fill) => (
            <fill.component
              key={fill.id}
              programId={course.program_id}
              courseId={course.id}
              onApplied={() => setRevision((n) => n + 1)}
            />
          ))}
          <CourseBasics
            key={`${course.id}:${revision}`}
            course={course}
            terms={terms.data?.items ?? []}
          />
        </>
      )}
    </AsyncBoundary>
  )
}

function CourseBasics({ course, terms }: { course: Course; terms: Term[] }) {
  const queryClient = useQueryClient()
  const update = useMutation({ ...academicsCourseUpdateMutation() })
  // The terms and the planned count are one choice: shown at once (optimistically), saved one
  // after the other, and put back from the server if either save fails.
  const courseKey = academicsCourseGetQueryKey({ path: { course_id: course.id } })
  const setTerms = useMutation({
    mutationFn: async (next: Saved) => {
      const path = { course_id: course.id }
      await academicsCourseSetTerms({ path, body: { term_ids: next.term_ids }, throwOnError: true })
      await academicsCourseUpdate({
        path,
        body: { planned_terms: next.planned_terms },
        throwOnError: true,
      })
    },
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: courseKey })
      queryClient.setQueryData<Course>(courseKey, (current) => current && { ...current, ...next })
    },
    onError: toastError,
    onSettled: () => invalidateAcademics(queryClient),
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
              inheritColor={subjectColor(course.subject_color)}
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
      </SettingsGroup>

      <SettingsBlock
        title={m.academics_course_instructors()}
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() => setInstructors([...instructors, { name: '' }])}
          >
            <Plus aria-hidden />
            {m.academics_instructor_add()}
          </Button>
        }
      >
        {instructors.length > 0 ? (
          <InstructorsContext value={{ change: changeInstructors, instructors }}>
            <SettingsTable
              label={m.academics_course_instructors()}
              data={instructors.map((person, index) => ({ index, person }))}
              columns={instructorColumns}
              getRowId={(line) => String(line.index)}
              columnClassName={INSTRUCTOR_COLUMN_CLASS}
              rowClassName={() => 'animate-in fade-in duration-200'}
            />
          </InstructorsContext>
        ) : (
          <Empty className="rounded-2xl border border-solid border-border p-6">
            <EmptyHeader>
              <EmptyTitle>{m.academics_instructors_empty()}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        )}
      </SettingsBlock>

      <SettingsBlock title={m.academics_course_terms()}>
        <CourseTerms
          terms={terms}
          termIds={course.term_ids}
          planned={course.planned_terms}
          onChange={(next) => setTerms.mutate(next)}
        />
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

type Saved = { term_ids: string[]; planned_terms: number }

/**
 * The course's terms (M02 §3): always one run of terms. A course in one term picks it; one that
 * spans terms picks where it starts and ends, the end among the terms after the start, so only
 * a valid run can be picked.
 */
function CourseTerms({
  terms,
  termIds,
  planned,
  onChange,
}: {
  terms: Term[]
  termIds: string[]
  planned: number
  onChange: (next: Saved) => void
}) {
  const range = rangeOf(terms, termIds, planned)
  const name = (id: string) =>
    id === NEXT_TERM ? m.academics_course_term_next() : (terms.find((t) => t.id === id)?.name ?? '')
  const termOptions = terms.map((t) => ({ value: t.id, label: t.name }))
  const endOptions = endChoices(terms, range.start).map((id) => ({ value: id, label: name(id) }))

  const choose = (start: string, end: string | null) => onChange(rangeTerms(terms, { start, end }))
  const span = (on: boolean) => {
    if (!on) return choose(range.start, null)
    const next = spanFrom(terms, range.start, range.end)
    choose(next.start, next.end)
  }
  const pickStart = (start: string) =>
    choose(start, range.spanning ? spanFrom(terms, start, range.end).end : null)

  return (
    <SettingsGroup>
      <SettingRow
        label={m.academics_course_year_long()}
        description={m.academics_course_year_long_hint()}
      >
        {(labelId) => (
          <Switch aria-labelledby={labelId} checked={range.spanning} onCheckedChange={span} />
        )}
      </SettingRow>
      <SettingRow label={m.academics_course_terms()}>
        {() => (
          <div className="flex items-center">
            <ChoiceControl
              select
              label={range.spanning ? m.academics_course_term_start() : m.academics_course_terms()}
              options={termOptions}
              value={range.start}
              onChange={pickStart}
              selectClassName="w-44"
            />
            {/* The end slides out beside the start, so the one setting reads "from … to …". */}
            <div
              className={cn(
                'grid transition-[grid-template-columns,opacity] duration-200 ease-out motion-reduce:transition-none',
                range.spanning ? 'grid-cols-[1fr] opacity-100' : 'grid-cols-[0fr] opacity-0',
              )}
              inert={!range.spanning}
            >
              <div className="flex items-center gap-2 overflow-hidden ps-2">
                <span className="text-sm text-muted-foreground">
                  {m.academics_course_term_to()}
                </span>
                <ChoiceControl
                  select
                  label={m.academics_course_term_end()}
                  options={endOptions}
                  value={range.spanning ? range.end : (endOptions[0]?.value ?? NEXT_TERM)}
                  onChange={(end) => choose(range.start, end)}
                  selectClassName="w-44"
                />
              </div>
            </div>
          </div>
        )}
      </SettingRow>
    </SettingsGroup>
  )
}
