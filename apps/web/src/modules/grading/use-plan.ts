import type {
  Gradebook,
  GradebookSummary,
  TermGradeSimulation,
  TermGrades,
} from '@semestra/api-client'
import { gradingSimulateCourse, gradingSimulateTerm } from '@semestra/api-client'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toastError } from '@/lib/errors'
import { type WhatIf, activeScores } from './whatif'

const SIMULATE_DELAY_MS = 200

/** `value`, once it has stopped changing for `delay` ms. */
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

/**
 * Runs a plan simulation for `body` after the user stopped typing, while `planning`. A new
 * answer keeps the previous one on screen until it arrives, so the planned figures never blink
 * to "—" between keystrokes; one computed against older real grades (`version`) is not kept.
 * Nothing is saved: the server only simulates.
 */
function usePlanQuery<B, T>(
  scope: string,
  version: string,
  planning: boolean,
  body: B,
  simulate: (body: B) => Promise<T>,
): T | null {
  // The fingerprint stands for `body`, which changes identity on every render.
  const fingerprint = useDebounced(JSON.stringify(body), SIMULATE_DELAY_MS)
  const query = useQuery({
    queryKey: ['grading-plan', scope, version, fingerprint],
    queryFn: () =>
      simulate(JSON.parse(fingerprint) as B).catch((error: unknown) => {
        toastError(error)
        throw error
      }),
    enabled: planning,
    retry: false,
    staleTime: Infinity,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === scope && previousQuery.queryKey[2] === version
        ? previous
        : undefined,
  })
  return planning ? (query.data ?? null) : null
}

/**
 * Plan mode (M03 §5.1): the assumed scores are simulated on the server (nothing is saved), so
 * the planned result and the target check always come from the same engine as real grades.
 * Returns the simulated summary while planning, null otherwise or until the first answer.
 */
export function usePlanSimulation(gradebook: Gradebook, whatIf: WhatIf): GradebookSummary | null {
  const courseId = gradebook.course_id
  const scores = activeScores(gradebook.assessments, whatIf.scores)
  // The course's own settings (target, forecast model, official grade) change the answer too.
  const version = [
    gradebook.result.updated_at,
    ...gradebook.assessments.map((a) => a.updated_at),
  ].join('|')
  return usePlanQuery(
    `course:${courseId}`,
    version,
    whatIf.plan,
    { scores, target: whatIf.target },
    async (body) =>
      (await gradingSimulateCourse({ path: { course_id: courseId }, body, throwOnError: true }))
        .data,
  )
}

/**
 * Plan mode of a term (M03 §5.2): the assumed final percentages of unfinished courses and the
 * goal are simulated on the server, the same way as a course's plan.
 */
export function useTermPlanSimulation(
  term: TermGrades,
  scores: Readonly<Record<string, number>>,
  targetGpa: number | null,
  includeInProgress: boolean,
  planning: boolean,
): TermGradeSimulation | null {
  const termId = term.term_id
  return usePlanQuery(
    `term:${termId}`,
    // A grade that changed under the plan (an edit elsewhere, a sync) refreshes it too.
    JSON.stringify(term.courses),
    planning,
    { scores, target_gpa: targetGpa, include_in_progress: includeInProgress },
    async (body) =>
      (await gradingSimulateTerm({ path: { term_id: termId }, body, throwOnError: true })).data,
  )
}
