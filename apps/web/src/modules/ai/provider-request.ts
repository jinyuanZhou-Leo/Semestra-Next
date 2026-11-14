import { useSyncExternalStore } from 'react'

/**
 * Asking the providers section to open one provider's edit dialog (a "Check provider" button
 * elsewhere). Kept until the section takes it, since the settings dialog opens after the ask.
 * Apart from the section so other modules can ask without loading the settings.
 */
let wanted: string | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

/** The provider to open, until the section has opened it. */
export function requestProviderEdit(providerId: string) {
  wanted = providerId
  emit()
}

/** The section opened it. */
export function takeProviderRequest() {
  if (wanted === null) return
  wanted = null
  emit()
}

export function useProviderRequest(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => wanted,
  )
}
