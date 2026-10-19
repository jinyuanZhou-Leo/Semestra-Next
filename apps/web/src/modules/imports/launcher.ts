import { useSyncExternalStore } from 'react'
import type { ImportOutcome, ImportRequest } from './types'

/**
 * Opens the import dialog from anywhere (the `launch()` of an import source) and resolves when it
 * closes. One import at a time: opening another closes the current one as cancelled.
 */
type Open = { request: ImportRequest; resolve: (outcome: ImportOutcome) => void; id: number }

let current: Open | null = null
let nextId = 1
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function openImport(request: ImportRequest): Promise<ImportOutcome> {
  current?.resolve(null)
  return new Promise((resolve) => {
    current = { request, resolve, id: nextId++ }
    emit()
  })
}

export function finishImport(outcome: ImportOutcome) {
  const open = current
  current = null
  open?.resolve(outcome)
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useOpenImport(): Open | null {
  return useSyncExternalStore(subscribe, () => current)
}
