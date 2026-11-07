import type { Assessment } from '@semestra/api-client'

/** Plan mode of one course (M03 §5.1), kept per course with `useUiPref('grading.whatif', …)`. */
export type WhatIf = {
  plan: boolean
  /** Assumed score in percent per ungraded assessment id. */
  scores: Record<string, number>
}

/** Plan mode uses the course's own (saved) target; a stored `target` from before is ignored. */
export const DEFAULT_WHATIF: WhatIf = { plan: false, scores: {} }

/** Assumptions that still apply: the assessment exists, has no real score and counts. */
export function activeScores(
  assessments: readonly Assessment[],
  scores: Readonly<Record<string, number>>,
): Record<string, number> {
  const open = new Set(
    assessments.filter((a) => a.score_percentage === null && !a.dropped).map((a) => a.id),
  )
  return Object.fromEntries(Object.entries(scores).filter(([id]) => open.has(id)))
}
