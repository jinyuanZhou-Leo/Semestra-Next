import { useEffect, useRef, useSyncExternalStore } from 'react'

/**
 * Host actions that commands trigger on whatever is on screen: the board of the page, its tab
 * bar, the shortcut help. The component that can do it registers a handler while mounted; the
 * most recently mounted one wins. A command is offered only while its action has a handler.
 */
export type HostAction = 'board.edit' | 'board.add' | 'nav.manage' | 'hotkeys.help'

const handlers = new Map<HostAction, (() => void)[]>()

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
    handlers.set(action, [...(handlers.get(action) ?? []), run])
    return () => {
      handlers.set(
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
