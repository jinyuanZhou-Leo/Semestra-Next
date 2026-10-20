import type { Gradebook, GradebookSummary } from '@semestra/api-client'
import { gradingSimulateCourseMutation } from '@semestra/api-client/react-query'
import { useMutation } from '@tanstack/react-query'
import { useEffect } from 'react'
import { toastError } from '@/lib/errors'
import { type WhatIf, activeScores } from './whatif'

const SIMULATE_DELAY_MS = 200

/**
 * Plan mode (M03 §5.1): the assumed scores are simulated on the server (nothing is saved), so
 * the planned result and the target check always come from the same engine as real grades.
 * Returns the simulated summary while planning, null otherwise or until the first answer.
 */
export function usePlanSimulation(gradebook: Gradebook, whatIf: WhatIf): GradebookSummary | null {
  const courseId = gradebook.course_id
  const scores = activeScores(gradebook.assessments, whatIf.scores)
  const target = whatIf.target
  const simulate = useMutation({ ...gradingSimulateCourseMutation(), onError: toastError })
  const { mutate: run, reset } = simulate
  // Refresh after the user stopped typing, and whenever the real gradebook changed under it.
  const fingerprint = JSON.stringify([scores, target])
  const version = gradebook.assessments.map((a) => a.updated_at).join('|')
  const planning = whatIf.plan
  useEffect(() => {
    // Leaving plan mode drops the last answer, so coming back never shows a stale plan.
    if (!planning) {
      reset()
      return
    }
    const timer = setTimeout(
      () => run({ path: { course_id: courseId }, body: { scores, target } }),
      SIMULATE_DELAY_MS,
    )
    return () => clearTimeout(timer)
    // `fingerprint` stands for `scores` and `target`, which change identity on every render.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [courseId, run, reset, fingerprint, version, planning])
  return planning ? (simulate.data ?? null) : null
}
