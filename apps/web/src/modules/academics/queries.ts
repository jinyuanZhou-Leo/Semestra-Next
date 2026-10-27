import type { Course, Program, Term } from '@semestra/api-client'
import {
  academicsCourseGetOptions,
  academicsCourseListOptions,
  academicsProgramGetOptions,
  academicsProgramListOptions,
  academicsTermListOptions,
} from '@semestra/api-client/react-query'
import { type QueryClient, useQueries, useQuery } from '@tanstack/react-query'
import type { ModuleManifest, Scope } from '@/app/extensions'
import { COURSE_COLUMNS, type CourseColumn } from './types'

export function usePrograms() {
  return useQuery(academicsProgramListOptions())
}

export function useProgram(programId: string) {
  return useQuery({
    ...academicsProgramGetOptions({ path: { program_id: programId } }),
  })
}

export function useTerms(programId: string) {
  return useQuery({
    ...academicsTermListOptions({ path: { program_id: programId } }),
    enabled: programId !== '',
  })
}

/** Every course of a Program, or of one term (the list is small; one page of up to 500). */
export function courseListOptions(programId: string, termId?: string) {
  return academicsCourseListOptions({
    path: { program_id: programId },
    query: { limit: 500, ...(termId ? { term_id: termId } : {}) },
  })
}

/** See `courseListOptions`; `enabled: false` waits (e.g. until the term is known). */
export function useCourses(programId: string, termId?: string, { enabled = true } = {}) {
  return useQuery({
    ...courseListOptions(programId, termId),
    enabled: enabled && programId !== '',
  })
}

export function useCourse(courseId: string) {
  return useQuery({
    ...academicsCourseGetOptions({ path: { course_id: courseId } }),
  })
}

function operationId(queryKey: readonly unknown[]): string {
  // oxlint-disable-next-line no-underscore-dangle -- hey-api's query key field
  return String((queryKey[0] as { _id?: unknown } | undefined)?._id ?? '')
}

/** Refetch everything the academics module shows, after a change made from this tab. */
export function invalidateAcademics(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    predicate: (query) => operationId(query.queryKey).startsWith('academics'),
  })
}

/** Courses of one term in the order of the term's list (the server already sorted them). */
export function coursesOfTerm(courses: readonly Course[], termId: string): Course[] {
  return courses.filter((c) => c.term_ids.includes(termId))
}

/** The Program to open: the remembered one if it still exists, else the first. */
export function pickProgram(
  programs: readonly Program[],
  activeProgramId: string | null | undefined,
): Program | undefined {
  return programs.find((p) => p.id === activeProgramId) ?? programs[0]
}

/**
 * The term a course page belongs to in the breadcrumb (M02 §5.5): the one the user came from
 * (`fromTerm`) when the course runs in it, else its term that is current, else its last term.
 */
export function courseTermId(
  course: Pick<Course, 'term_ids' | 'end_term_id'>,
  terms: readonly Term[] | undefined,
  fromTerm: string | undefined,
): string {
  if (fromTerm && course.term_ids.includes(fromTerm)) return fromTerm
  const current = terms?.find((t) => t.is_current && course.term_ids.includes(t.id))
  return current?.id ?? course.end_term_id
}

/** The term's courses card: its courses and its extra columns' data (`CardContribution.prefetch`). */
export function prefetchTermCourses(
  scope: Scope,
  queryClient: QueryClient,
  { modules }: { modules: readonly ModuleManifest[] },
) {
  if (scope.kind !== 'term') return
  void queryClient.prefetchQuery(courseListOptions(scope.programId, scope.termId))
  for (const module of modules) {
    for (const column of (module.extensions?.[COURSE_COLUMNS] ?? []) as readonly CourseColumn[]) {
      if (column.showInTermCard && column.query)
        void queryClient.prefetchQuery(column.query(scope.programId))
    }
  }
}

/**
 * What the extension columns asked for with `CourseColumn.query`, keyed by column id. The list
 * of columns may change when a plugin is installed, which `useQueries` allows.
 */
export function useColumnData(
  columns: readonly CourseColumn[],
  programId: string,
): ReadonlyMap<string, unknown> {
  const results = useQueries({
    queries: columns.map((column) =>
      column.query
        ? column.query(programId)
        : { queryKey: ['academics', 'column-without-data', column.id], enabled: false },
    ),
  })
  return new Map(columns.map((column, i) => [column.id, results[i]?.data]))
}
