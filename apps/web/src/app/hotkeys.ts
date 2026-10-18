import { useEffect, useSyncExternalStore } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import type { Message } from './extensions'

/**
 * Global keyboard shortcuts (M10 §5.5), on react-hotkeys-hook. `useHotkey('mod+k', open)` listens
 * while the component is mounted; `mod` is ⌘ on Apple keyboards and Ctrl elsewhere, `'g>t'` is a
 * sequence (the second key within a second). Shortcuts never fire while typing in a field unless
 * `allowInInputs` is set.
 * Shortcuts registered with a `description` are listed in the help dialog (`?`).
 */

export type HotkeyInfo = { id: string; keys: string; description: Message; order: number }

const listed = new Map<string, HotkeyInfo>()
const listeners = new Set<() => void>()
let snapshot: HotkeyInfo[] = []

function changed() {
  snapshot = [...listed.values()].sort((a, b) => a.order - b.order)
  for (const listener of listeners) listener()
}

/** Shortcuts shown in the help dialog: the ones mounted now. */
export function useListedHotkeys(): HotkeyInfo[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => snapshot,
    () => snapshot,
  )
}

export function isApple(): boolean {
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    ''
  return /mac|iphone|ipad/i.test(platform)
}

/** How a combo is written for people: `mod+k` → `⌘ K` / `Ctrl K`. */
export function formatHotkey(combo: string): string {
  return combo
    .split('>')
    .map((step) =>
      step
        .split('+')
        .map((part) => {
          if (part === 'mod') return isApple() ? '⌘' : 'Ctrl'
          if (part === 'shift') return isApple() ? '⇧' : 'Shift'
          if (part === 'alt') return isApple() ? '⌥' : 'Alt'
          if (part === 'up') return '↑'
          if (part === 'down') return '↓'
          return part.length === 1 ? part.toUpperCase() : part
        })
        .join(isApple() ? '' : '+'),
    )
    .join(' ')
}

export function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
}

type Options = {
  enabled?: boolean
  /** Listed in the shortcut help when set. */
  description?: Message
  order?: number
  /** Fire inside text fields too (only use for combos with a modifier). */
  allowInInputs?: boolean
  /** Match the produced character (for `?`) instead of the physical key. */
  useKey?: boolean
}

/** A shortcut on top of react-hotkeys-hook that also shows up in the help dialog. */
export function useHotkey(
  combo: string,
  handler: (event: KeyboardEvent) => void,
  options: Options = {},
) {
  const { enabled = true, description, order = 100, allowInInputs = false, useKey } = options
  useEffect(() => {
    if (!enabled || !description) return
    const id = `${combo}:${Math.random().toString(36).slice(2)}`
    listed.set(id, { id, keys: combo, description, order })
    changed()
    return () => {
      listed.delete(id)
      changed()
    }
  }, [combo, description, enabled, order])

  useHotkeys(combo, (event) => handler(event), {
    enabled,
    enableOnFormTags: allowInInputs,
    enableOnContentEditable: allowInInputs,
    preventDefault: true,
    useKey,
  })
}
