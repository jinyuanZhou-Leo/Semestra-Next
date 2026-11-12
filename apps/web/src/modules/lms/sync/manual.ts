/**
 * Programs whose sync the user asked for: when it ends with nothing new, the app says so
 * ("{provider} is up to date"); a background sync that changes nothing says nothing.
 */
const asked = new Set<string>()

export function markManualSync(programId: string) {
  asked.add(programId)
}

/** Whether the user asked for the Program's sync since the last call (and forgets it). */
export function takeManualSync(programId: string): boolean {
  return asked.delete(programId)
}
