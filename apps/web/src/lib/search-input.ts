import type { KeyboardEvent, MouseEvent } from 'react'

/** Click handler of a search box's clear button: empties it and puts the cursor back in the field. */
export function clearSearch(event: MouseEvent<HTMLElement>, clear: () => void) {
  clear()
  event.currentTarget.closest('[data-slot="input-group"]')?.querySelector('input')?.focus()
}

/** Esc empties a search box that has text (and stops there, so a dialog around it stays open). */
export function clearOnEscape(value: string, clear: () => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && value) {
      event.preventDefault()
      event.stopPropagation()
      clear()
    }
  }
}
