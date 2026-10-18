import { useEffect, useState } from 'react'
import {
  clampProgress,
  PROGRESS_CREEP_BUDGET,
  smoothedProgressTarget,
} from '@/lib/smoothed-progress'

const PROGRESS_TICK_MS = 100
const PROGRESS_CATCH_UP_RATIO = 0.2
const PROGRESS_MIN_CATCH_UP_STEP = 0.2

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** The progress to display while `running`: catches up smoothly and creeps during stalls. */
export function useSmoothedProgress(actualProgress: number, running: boolean): number {
  const actual = clampProgress(actualProgress)
  const animate = running && !prefersReducedMotion()
  const [displayProgress, setDisplayProgress] = useState(actual)

  useEffect(() => {
    if (!animate) return
    const progressChangedAt = Date.now()
    const timer = window.setInterval(() => {
      setDisplayProgress((current) => {
        // A large backwards jump means a new task, not a progress update.
        if (current - actual > PROGRESS_CREEP_BUDGET) return actual
        if (current < actual) {
          const step = Math.max(
            PROGRESS_MIN_CATCH_UP_STEP,
            (actual - current) * PROGRESS_CATCH_UP_RATIO,
          )
          return Math.min(actual, current + step)
        }
        return Math.max(current, smoothedProgressTarget(actual, Date.now() - progressChangedAt))
      })
    }, PROGRESS_TICK_MS)
    return () => window.clearInterval(timer)
  }, [actual, animate])

  if (!animate || displayProgress - actual > PROGRESS_CREEP_BUDGET) return actual
  return displayProgress
}
