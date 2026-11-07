import { type RefObject, useEffect, useEffectEvent } from 'react'

/** Popups opened from a row (menus, the calendar); clicks in them stay "inside" the row. */
const POPUPS =
  '[data-slot="popover-content"],[data-slot="dropdown-menu-content"],[data-slot="dropdown-menu-sub-content"],[data-slot="select-content"]'

/**
 * How a row open for editing closes (M05 §5.1): a click outside it (not in one of its popups) or
 * tabbing away calls `onLeave`; Esc anywhere in the row calls `onEscape`. A popup takes its own
 * Esc first, and a time field uses Esc to undo just the time.
 */
export function useEditorExit(
  rowRef: RefObject<HTMLElement | null>,
  { onLeave, onEscape }: { onLeave: () => void; onEscape: () => void },
) {
  const escape = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return
    if (event.target instanceof HTMLInputElement && event.target.type === 'time') return
    event.preventDefault()
    onEscape()
  })
  const leave = useEffectEvent((target: EventTarget | null, row: HTMLElement) => {
    if (target instanceof Node && row.contains(target)) return
    if (target instanceof Element && target.closest(POPUPS)) return
    onLeave()
  })
  useEffect(() => {
    const row = rowRef.current
    if (!row) return
    // Closing on the click, not the press: closing on the press would shift the rows below
    // under the pointer, and the click meant for another row's title would miss it.
    let pressed = false
    let popupWasOpen = false
    const onPointerDown = () => {
      pressed = true
      popupWasOpen = row.querySelector('[aria-expanded="true"]') !== null
    }
    const onPointerUp = () => {
      pressed = false
    }
    const onClick = (event: MouseEvent) => {
      // The first click outside an open menu or calendar only closes that popup.
      if (!popupWasOpen) leave(event.target, row)
      popupWasOpen = false
    }
    // Tabbing away; focus moved by a press is left to the click.
    const onFocusOut = (event: FocusEvent) => {
      if (!pressed && event.relatedTarget) leave(event.relatedTarget, row)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointerup', onPointerUp, true)
    document.addEventListener('click', onClick, true)
    row.addEventListener('focusout', onFocusOut)
    row.addEventListener('keydown', escape)
    return () => {
      row.removeEventListener('keydown', escape)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointerup', onPointerUp, true)
      document.removeEventListener('click', onClick, true)
      row.removeEventListener('focusout', onFocusOut)
    }
  }, [rowRef])
}

/** Focuses a field with the caret at `caret` (the end when unset). */
export function focusAt(el: HTMLInputElement | HTMLTextAreaElement | null, caret?: number) {
  if (!el) return
  el.focus()
  const at = Math.min(caret ?? el.value.length, el.value.length)
  el.setSelectionRange(at, at)
}
