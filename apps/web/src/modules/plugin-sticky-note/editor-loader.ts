import { useSyncExternalStore } from 'react'

type EditorModule = typeof import('./NoteEditor')

/**
 * The note's editor (M14 §4), loaded the first time a note is edited or a checklist item ticked.
 * Hovering or focusing a note starts loading it, so it is usually there by the click; until then
 * the note keeps showing as it reads (`NoteView`).
 */
let loaded: EditorModule | null = null
let loading: Promise<EditorModule> | null = null
const listeners = new Set<() => void>()

export function loadEditor(): Promise<EditorModule> {
  loading ??= import('./NoteEditor').then(
    (module) => {
      loaded = module
      for (const listener of listeners) listener()
      return module
    },
    (error: unknown) => {
      // The next attempt tries again.
      loading = null
      throw error
    },
  )
  return loading
}

/** Starts loading the editor without waiting for it (hover and focus). */
export function preloadEditor() {
  loadEditor().catch(() => {})
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The editor's code once it has loaded. */
export function useEditorModule(): EditorModule | null {
  return useSyncExternalStore(subscribe, () => loaded)
}
