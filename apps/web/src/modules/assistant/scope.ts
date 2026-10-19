import type { AgentScope, Term } from '@semestra/api-client'
import type { Scope } from '@/app/extensions'
import {
  academicsCourseListOptions,
  academicsProgramGetOptions,
  academicsTermListOptions,
} from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { courseLabel } from '@/modules/academics/color'
import { courseTermId } from '@/modules/academics/queries'

export const programScope = (programId: string): AgentScope => ({
  program_id: programId,
  term_id: null,
  course_id: null,
})

export const termScope = (programId: string, termId: string): AgentScope => ({
  program_id: programId,
  term_id: termId,
  course_id: null,
})

/**
 * Where the assistant works when opened on this page: the Program or a term. A course page
 * gives the course's term (the scope stops at the term); while the course loads, the Program.
 */
export function usePageScope(scope: Scope | undefined): AgentScope | null {
  const { terms, courses } = useProgramEntities(
    scope?.kind === 'course' ? scope.programId : undefined,
  )
  if (!scope) return null
  if (scope.kind === 'term') return termScope(scope.programId, scope.termId)
  if (scope.kind === 'course') {
    const course = courses.find((c) => c.id === scope.courseId)
    if (course) return termScope(scope.programId, courseTermId(course, terms, undefined))
  }
  return programScope(scope.programId)
}

/** The Program's terms for the scope menu: the current one first, then the latest first. */
export function termsForScope(terms: readonly Term[]): Term[] {
  return terms.toSorted(
    (a, b) =>
      Number(b.is_current) - Number(a.is_current) || b.start_date.localeCompare(a.start_date),
  )
}

export function sameScope(a: AgentScope | null | undefined, b: AgentScope | null | undefined) {
  return (
    (a?.program_id ?? null) === (b?.program_id ?? null) &&
    (a?.term_id ?? null) === (b?.term_id ?? null) &&
    (a?.course_id ?? null) === (b?.course_id ?? null)
  )
}

export type ScopeKind = 'program' | 'term' | 'course'

export function scopeKind(scope: AgentScope): ScopeKind {
  return scope.course_id ? 'course' : scope.term_id ? 'term' : 'program'
}

const STALE = 30_000

function useProgramData(programId: string | undefined) {
  return useQuery({
    ...academicsProgramGetOptions({ path: { program_id: programId ?? '' } }),
    enabled: Boolean(programId),
    staleTime: STALE,
  }).data
}

/** The terms and courses of a Program, for labels and `@` references. */
export function useProgramEntities(programId: string | undefined) {
  const terms = useQuery({
    ...academicsTermListOptions({ path: { program_id: programId ?? '' } }),
    enabled: Boolean(programId),
    staleTime: STALE,
  })
  const courses = useQuery({
    ...academicsCourseListOptions({
      path: { program_id: programId ?? '' },
      query: { limit: 500 },
    }),
    enabled: Boolean(programId),
    staleTime: STALE,
  })
  return { terms: terms.data?.items ?? [], courses: courses.data?.items ?? [] }
}

/** "Fall 2026" or the Program's name ("APS105 · Fall 2026" for older course scopes). */
export function useScopeLabel(scope: AgentScope | null): string | null {
  const program = useProgramData(scope?.program_id)
  const { terms, courses } = useProgramEntities(scope?.program_id)
  if (!scope) return null
  const termName = (id: string | null | undefined) => terms.find((t) => t.id === id)?.name
  if (scope.course_id) {
    const course = courses.find((c) => c.id === scope.course_id)
    if (!course) return null
    const term = termName(scope.term_id ?? course.term_ids[0])
    return term ? `${courseLabel(course)} · ${term}` : courseLabel(course)
  }
  if (scope.term_id) return termName(scope.term_id) ?? null
  return program?.name ?? null
}
