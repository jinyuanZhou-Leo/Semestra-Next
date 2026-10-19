import { useEffect, useRef, useSyncExternalStore } from 'react'

/**
 * Host actions that commands trigger on whatever is on screen: the board of the page, its tab
 * bar, the shortcut help. The component that can do it registers a handler while mounted; the
 * most recently mounted one wins. `board.shown` only says that a board is on screen outside
 * edit mode, so the tab bar can offer its "Edit layout" button even while editing is not yet
 * possible. `settings.plugins` opens the plugin group of the settings dialog. A command is
 * offered only while its action has a handler.
 */
export type HostAction =
  | 'board.edit'
  | 'board.add'
  | 'board.shown'
  | 'nav.manage'
  | 'hotkeys.help'
  | 'settings.plugins'

const handlers = new Map<HostAction, (() => void)[]>()
const handlerListeners = new Set<() => void>()

function setHandlers(action: HostAction, next: (() => void)[]) {
  handlers.set(action, next)
  for (const listener of handlerListeners) listener()
}

/** Whether some mounted component handles `action`, e.g. to show a button only then. */
export function useHasHostAction(action: HostAction): boolean {
  return useSyncExternalStore(
    (listener) => {
      handlerListeners.add(listener)
      return () => handlerListeners.delete(listener)
    },
    () => hasHostAction(action),
    () => false,
  )
}

export function hasHostAction(action: HostAction): boolean {
  return (handlers.get(action)?.length ?? 0) > 0
}

export function runHostAction(action: HostAction): boolean {
  const handler = handlers.get(action)?.at(-1)
  handler?.()
  return handler !== undefined
}

/** Registers `handler` for `action` while mounted and `enabled`. */
export function useHostAction(action: HostAction, handler: () => void, enabled = true) {
  const latest = useRef(handler)
  useEffect(() => {
    latest.current = handler
  })
  useEffect(() => {
    if (!enabled) return
    const run = () => latest.current()
    setHandlers(action, [...(handlers.get(action) ?? []), run])
    return () => {
      setHandlers(
        action,
        (handlers.get(action) ?? []).filter((h) => h !== run),
      )
    }
  }, [action, enabled])
}

/** Whether the command palette is open, and the text it opens with. */
type PaletteState = { open: boolean; query: string }

let palette: PaletteState = { open: false, query: '' }
const paletteListeners = new Set<() => void>()

export function setPalette(next: PaletteState) {
  palette = next
  for (const listener of paletteListeners) listener()
}

/** Opens the command palette, e.g. from a sidebar button; `query: '/'` lists only actions. */
export function openCommandPalette(query = '') {
  setPalette({ open: true, query })
}

export function usePaletteState(): PaletteState {
  return useSyncExternalStore(
    (listener) => {
      paletteListeners.add(listener)
      return () => paletteListeners.delete(listener)
    },
    () => palette,
    () => palette,
  )
}
