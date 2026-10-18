/**
 * Displayed progress for long tasks (M00 §4.7.1, migrated from bid-analysis-agent). When the
 * backend has not reported for a while the bar keeps creeping a little so it never looks frozen,
 * but never past the ceiling and never more than the budget ahead of the real value.
 */

export const PROGRESS_STALL_DELAY_MS = 2_000
export const PROGRESS_CREEP_DURATION_MS = 20_000
export const PROGRESS_CREEP_BUDGET = 5
export const PROGRESS_CREEP_CEILING = 95

export function clampProgress(progress: number) {
  return Math.max(0, Math.min(100, progress))
}

export function smoothedProgressTarget(actualProgress: number, stalledForMs: number) {
  const actual = clampProgress(actualProgress)
  if (actual >= PROGRESS_CREEP_CEILING) return actual
  if (stalledForMs <= PROGRESS_STALL_DELAY_MS) return actual

  const creepRatio = Math.min(
    1,
    (stalledForMs - PROGRESS_STALL_DELAY_MS) / PROGRESS_CREEP_DURATION_MS,
  )
  // Ease out so the creep slows down instead of looking linear.
  const easedRatio = 1 - (1 - creepRatio) ** 2
  return Math.min(PROGRESS_CREEP_CEILING, actual + PROGRESS_CREEP_BUDGET * easedRatio)
}
