/**
 * The card header's "reset" and the card body edit the same count, so the reset goes through the
 * body's own settings state (one queue per card) instead of a second, independent one.
 */
const resets = new Map<string, () => void>()

export function registerReset(instanceId: string, reset: () => void): () => void {
  resets.set(instanceId, reset)
  return () => {
    if (resets.get(instanceId) === reset) resets.delete(instanceId)
  }
}

export function resetCounter(instanceId: string) {
  resets.get(instanceId)?.()
}
