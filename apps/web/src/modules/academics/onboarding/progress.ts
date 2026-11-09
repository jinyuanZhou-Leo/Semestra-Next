// Kept apart from the onboarding screen, so the route's guard does not pull it into the first load.

const STORAGE_KEY = 'semestra.onboarding'

/**
 * Where the first run is, and what it has made so far. Steps are named by id, so a step that is
 * offered on one load and not the next cannot shift the others; going back keeps all of it.
 */
export type Progress = {
  /** Progress of one user: another account signing in to the same tab starts over. */
  userId?: string
  step: string
  /** The Program, once the Program step created it. */
  programId?: string
  /** What the Program form's setup rows were set to (they are not part of the Program). */
  setup?: Record<string, unknown>
  /** The first term once created, or `later` when it was left for later. */
  term?: { id: string; name: string; courses: number } | 'later'
}

/** Whether an onboarding started in this tab already made its Program (and continues after it). */
export function onboardingInProgress(userId: string): boolean {
  return load(userId).programId !== undefined
}

export function load(userId: string | undefined): Progress {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    const progress = raw ? (JSON.parse(raw) as Partial<Progress>) : null
    if (typeof progress?.step === 'string' && progress.userId === userId)
      return { ...progress, userId, step: progress.step }
  } catch {
    // Start over.
  }
  return { userId, step: 'welcome' }
}

export function store(progress: Progress | null) {
  try {
    if (progress) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(progress))
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage blocked: a reload starts over.
  }
}
