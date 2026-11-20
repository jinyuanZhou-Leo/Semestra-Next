import { useSyncExternalStore } from 'react'

/**
 * Which notes are being edited (M14 §4). The note is read-only until its edit button (in the card
 * header, a separate component) or a double-click starts editing, so the header and the body
 * share this per-card flag. A note keeps its editor once it has been edited (`opened`), so ending
 * an edit does not swap the text out again.
 */
const editing = new Set<string>()
const opened = new Set<string>()
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const notify = () => {
  for (const listener of listeners) listener()
}

export function setNoteEditing(instanceId: string, on: boolean) {
  if (on === editing.has(instanceId)) return
  if (on) {
    editing.add(instanceId)
    opened.add(instanceId)
  } else editing.delete(instanceId)
  notify()
}

/**
 * The note goes back to read-only without its editor: its card is gone, or the editor's code
 * could not load.
 */
export function forgetNote(instanceId: string) {
  const known = opened.has(instanceId)
  editing.delete(instanceId)
  opened.delete(instanceId)
  if (known) notify()
}

export function useNoteEditing(instanceId: string): boolean {
  return useSyncExternalStore(subscribe, () => editing.has(instanceId))
}

export function useNoteOpened(instanceId: string): boolean {
  return useSyncExternalStore(subscribe, () => opened.has(instanceId))
}
