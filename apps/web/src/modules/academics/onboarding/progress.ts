// Kept apart from the onboarding screen, so the route's guard does not pull it into the first load.

const STORAGE_KEY = 'semestra.onboarding'

/** Progress of one user: another account signing in to the same tab starts over. */
export type Progress = { userId?: string; step: number; programId?: string; termId?: string }

/** Whether an onboarding was started in this tab (it then continues after the Program exists). */
export function onboardingInProgress(userId: string): boolean {
  return load(userId).step > 0
}

export function load(userId: string | undefined): Progress {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    const progress = raw ? (JSON.parse(raw) as Progress) : null
    if (progress && progress.userId === userId) return progress
  } catch {
    // Start over.
  }
  return { userId, step: 0 }
}

export function store(progress: Progress | null) {
  try {
    if (progress) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(progress))
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage blocked: a reload starts over.
  }
}
