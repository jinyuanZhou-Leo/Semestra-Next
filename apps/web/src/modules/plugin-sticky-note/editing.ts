import { useSyncExternalStore } from 'react'

/**
 * Which notes are being edited (M14 §4). The note is read-only until its edit button (in the card
 * header, a separate component) or a double-click starts editing, so the header and the body
 * share this per-card flag.
 */
const editing = new Set<string>()
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setNoteEditing(instanceId: string, on: boolean) {
  if (on === editing.has(instanceId)) return
  if (on) editing.add(instanceId)
  else editing.delete(instanceId)
  for (const listener of listeners) listener()
}

export function useNoteEditing(instanceId: string): boolean {
  return useSyncExternalStore(subscribe, () => editing.has(instanceId))
}
