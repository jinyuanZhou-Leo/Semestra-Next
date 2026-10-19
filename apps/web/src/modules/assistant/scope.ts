import type { AgentScope } from '@semestra/api-client'
import type { Scope } from '@/app/extensions'
import {
  academicsCourseListOptions,
  academicsProgramGetOptions,
  academicsTermListOptions,
} from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { courseLabel } from '@/modules/academics/color'

/** The page's scope as the assistant's context. */
export function agentScope(scope: Scope | undefined): AgentScope | null {
  if (!scope) return null
  return {
    program_id: scope.programId,
    term_id: scope.kind === 'term' ? scope.termId : null,
    course_id: scope.kind === 'course' ? scope.courseId : null,
  }
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

/** "APS105 · Fall 2026", "Fall 2026" or the Program's name. */
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
