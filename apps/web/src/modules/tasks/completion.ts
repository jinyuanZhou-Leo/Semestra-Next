import { useSyncExternalStore } from 'react'

/** How long a checked-off task stays where it is before it moves to "Completed" (M05 §5.1). */
export const COMPLETE_DELAY_MS = 5000
/** The check-off animation; a row shown again after it (a remount) does not play it again. */
const ANIMATE_MS = 500
/** The last part of the wait, while the row fades out. */
const LEAVE_MS = 250

/**
 * `checking`: just checked off, the animation plays; `checked`: done, still in place;
 * `leaving`: fading out, about to be saved.
 */
export type Completing = 'checking' | 'checked' | 'leaving'

/** Saves the completion; `unloading` when the page is being hidden or closed. */
type Commit = (unloading: boolean) => Promise<unknown>

type Pending = { phase: Completing; timers: number[]; commit: Commit }

const pending = new Map<string, Pending>()
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function stop(entry: Pending) {
  for (const timer of entry.timers) window.clearTimeout(timer)
}

/**
 * Checks a task off without saving it yet: the row stays checked in place for
 * `COMPLETE_DELAY_MS`, then `commit` saves it. Unchecking it before then (`cancelCompletion`)
 * leaves it as it was. The waits live outside any component, so leaving the page does not drop
 * them; hiding or closing the tab saves them at once.
 */
export function scheduleCompletion(taskId: string, commit: Commit) {
  if (pending.has(taskId)) return
  const entry: Pending = { phase: 'checking', timers: [], commit }
  const enter = (phase: Completing) => () => {
    entry.phase = phase
    emit()
  }
  entry.timers = [
    window.setTimeout(enter('checked'), ANIMATE_MS),
    window.setTimeout(enter('leaving'), COMPLETE_DELAY_MS - LEAVE_MS),
    window.setTimeout(() => void finish(taskId, false), COMPLETE_DELAY_MS),
  ]
  pending.set(taskId, entry)
  emit()
}

/** Unchecks (or forgets, before a delete) a task still waiting; false when it was not waiting. */
export function cancelCompletion(taskId: string): boolean {
  const entry = pending.get(taskId)
  if (!entry) return false
  stop(entry)
  pending.delete(taskId)
  emit()
  return true
}

export function isCompleting(taskId: string): boolean {
  return pending.has(taskId)
}

function finish(taskId: string, unloading: boolean): Promise<unknown> {
  const entry = pending.get(taskId)
  if (!entry) return Promise.resolve()
  stop(entry)
  // Saved before the row stops showing as checked: the optimistic update takes it out of the list.
  const saved = entry.commit(unloading).catch(() => undefined)
  pending.delete(taskId)
  emit()
  return saved
}

/** Saves every waiting task now (sign-out, leaving the page). */
export function flushCompletions(unloading = false): Promise<unknown> {
  return Promise.all([...pending.keys()].map((taskId) => finish(taskId, unloading)))
}

/** Forgets every waiting task without saving (the session is already gone). */
export function dropCompletions() {
  for (const taskId of [...pending.keys()]) cancelCompletion(taskId)
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flushCompletions(true))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushCompletions(true)
  })
}

/** Whether `taskId` was just checked off and is waiting in place, and in which phase. */
export function useCompleting(taskId: string): Completing | null {
  return useSyncExternalStore(subscribe, () => pending.get(taskId)?.phase ?? null)
}
