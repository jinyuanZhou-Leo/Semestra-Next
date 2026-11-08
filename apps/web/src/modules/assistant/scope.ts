import type { AgentScope, Term } from '@semestra/api-client'
import type { Scope } from '@/app/extensions'
import {
  academicsCourseListOptions,
  academicsProgramGetOptions,
  academicsTermListOptions,
} from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { courseTermId } from '@/modules/academics/queries'

export const programScope = (programId: string): AgentScope => ({
  program_id: programId,
  term_id: null,
})

export const termScope = (programId: string, termId: string): AgentScope => ({
  program_id: programId,
  term_id: termId,
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

function useProgramData(programId: string | undefined) {
  return useQuery({
    ...academicsProgramGetOptions({ path: { program_id: programId ?? '' } }),
    enabled: Boolean(programId),
  }).data
}

/** The terms and courses of a Program, for labels and `@` references. */
export function useProgramEntities(programId: string | undefined) {
  const terms = useQuery({
    ...academicsTermListOptions({ path: { program_id: programId ?? '' } }),
    enabled: Boolean(programId),
  })
  const courses = useQuery({
    ...academicsCourseListOptions({
      path: { program_id: programId ?? '' },
      query: { limit: 500 },
    }),
    enabled: Boolean(programId),
  })
  return { terms: terms.data?.items ?? [], courses: courses.data?.items ?? [] }
}

/** The term's name ("Fall 2026"), or the Program's for a Program-wide scope. */
export function useScopeLabel(scope: AgentScope | null): string | null {
  const program = useProgramData(scope?.program_id)
  const { terms } = useProgramEntities(scope?.program_id)
  if (!scope) return null
  if (scope.term_id) return terms.find((t) => t.id === scope.term_id)?.name ?? null
  return program?.name ?? null
}
