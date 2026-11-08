// Kept apart from the onboarding screen, so the route's guard does not pull it into the first load.

const STORAGE_KEY = 'semestra.onboarding'

/**
 * Where the first run is. Steps other modules add are named by id, so a step that is available
 * on one load and not the next cannot shift the others; the Program (and the term, once there)
 * travel with the steps that need them.
 */
export type Stage =
  | { kind: 'language' }
  | { kind: 'program' }
  | { kind: 'term'; programId: string }
  | { kind: 'extra'; id: string; programId: string; termId?: string }
  | { kind: 'done'; programId: string; termId?: string }

/** Progress of one user: another account signing in to the same tab starts over. */
export type Progress = { userId?: string; stage: Stage }

/** Whether an onboarding was started in this tab (it then continues after the Program exists). */
export function onboardingInProgress(userId: string): boolean {
  return load(userId).stage.kind !== 'language'
}

export function load(userId: string | undefined): Progress {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    const progress = raw ? (JSON.parse(raw) as Partial<Progress>) : null
    if (progress?.stage?.kind && progress.userId === userId)
      return { userId, stage: progress.stage }
  } catch {
    // Start over.
  }
  return { userId, stage: { kind: 'language' } }
}

export function store(progress: Progress | null) {
  try {
    if (progress) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(progress))
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage blocked: a reload starts over.
  }
}
