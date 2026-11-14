/**
 * How long after start a preload waits: an idle main thread says nothing about the network,
 * and the first page's code and data load in these first moments. Like the command palette.
 */
const SETTLE_DELAY_MS = 2000
/** Longest wait for an idle moment after that before preloading anyway. */
const IDLE_TIMEOUT_MS = 5000

/** Runs `task` once the page has settled (a delay, then an idle moment); returns a cancel function. */
export function whenSettled(task: () => void): () => void {
  let cancelIdle: (() => void) | undefined
  const timer = setTimeout(() => {
    cancelIdle = whenIdle(task)
  }, SETTLE_DELAY_MS)
  return () => {
    clearTimeout(timer)
    cancelIdle?.()
  }
}

/** Runs `task` in the next idle moment (at most `IDLE_TIMEOUT_MS` away); returns a cancel function. */
export function whenIdle(task: () => void): () => void {
  // `requestIdleCallback` is missing in older Safari: run it now.
  if (typeof requestIdleCallback !== 'function') {
    task()
    return () => undefined
  }
  const idle = requestIdleCallback(task, { timeout: IDLE_TIMEOUT_MS })
  return () => cancelIdleCallback(idle)
}
