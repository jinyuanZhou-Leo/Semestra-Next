import type { Course, Program, Term } from '@semestra/api-client'
import {
  academicsCourseGetOptions,
  academicsCourseListOptions,
  academicsProgramGetOptions,
  academicsProgramListOptions,
  academicsTermListOptions,
} from '@semestra/api-client/react-query'
import { type QueryClient, useQuery } from '@tanstack/react-query'

const STALE = 30_000

export function usePrograms() {
  return useQuery({ ...academicsProgramListOptions(), staleTime: STALE })
}

export function useProgram(programId: string) {
  return useQuery({
    ...academicsProgramGetOptions({ path: { program_id: programId } }),
    staleTime: STALE,
  })
}

export function useTerms(programId: string) {
  return useQuery({
    ...academicsTermListOptions({ path: { program_id: programId } }),
    staleTime: STALE,
  })
}

/** Every course of a Program (the list is small; one page of up to 500). */
export function useCourses(programId: string, termId?: string) {
  return useQuery({
    ...academicsCourseListOptions({
      path: { program_id: programId },
      query: { limit: 500, ...(termId ? { term_id: termId } : {}) },
    }),
    staleTime: STALE,
  })
}

export function useCourse(courseId: string) {
  return useQuery({
    ...academicsCourseGetOptions({ path: { course_id: courseId } }),
    staleTime: STALE,
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

/** The term that is current now (`is_current`), else the first. */
export function currentTerm(terms: readonly Term[] | undefined): Term | undefined {
  return terms?.find((t) => t.is_current) ?? terms?.[0]
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
