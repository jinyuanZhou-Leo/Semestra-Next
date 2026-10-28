import { useSyncExternalStore } from 'react'

/** How long a checked-off task stays where it is before it moves to "Completed" (M05 §5.1). */
export const COMPLETE_DELAY_MS = 5000
/** The last part of the wait, while the row fades out. */
const LEAVE_MS = 250

/** `checked`: just checked off, still in place; `leaving`: fading out, about to be saved. */
export type Completing = 'checked' | 'leaving'

type Pending = { phase: Completing; timers: number[]; commit: () => void }

const pending = new Map<string, Pending>()
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Checks a task off without saving it yet: the row stays checked in place for
 * `COMPLETE_DELAY_MS`, then `commit` saves it. Unchecking it before then (`cancelCompletion`)
 * leaves it as it was. The waits live outside any component, so leaving the page does not drop
 * them; hiding or closing the tab saves them at once.
 */
export function scheduleCompletion(taskId: string, commit: () => void) {
  if (pending.has(taskId)) return
  const entry: Pending = { phase: 'checked', timers: [], commit }
  entry.timers = [
    window.setTimeout(() => {
      entry.phase = 'leaving'
      emit()
    }, COMPLETE_DELAY_MS - LEAVE_MS),
    window.setTimeout(() => finish(taskId), COMPLETE_DELAY_MS),
  ]
  pending.set(taskId, entry)
  emit()
}

/** Unchecks a task still waiting to be saved; false when it was not waiting. */
export function cancelCompletion(taskId: string): boolean {
  const entry = pending.get(taskId)
  if (!entry) return false
  for (const timer of entry.timers) window.clearTimeout(timer)
  pending.delete(taskId)
  emit()
  return true
}

export function isCompleting(taskId: string): boolean {
  return pending.has(taskId)
}

function finish(taskId: string) {
  const entry = pending.get(taskId)
  if (!entry) return
  for (const timer of entry.timers) window.clearTimeout(timer)
  // Saved before the row stops showing as checked: the optimistic update takes it out of the list.
  entry.commit()
  pending.delete(taskId)
  emit()
}

/** Saves every waiting task now. */
export function flushCompletions() {
  for (const taskId of [...pending.keys()]) finish(taskId)
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushCompletions)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushCompletions()
  })
}

/** Whether `taskId` was just checked off and is waiting in place, and in which phase. */
export function useCompleting(taskId: string): Completing | null {
  return useSyncExternalStore(subscribe, () => pending.get(taskId)?.phase ?? null)
}
