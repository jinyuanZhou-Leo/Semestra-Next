import { useUiPref } from '@/app/ui-pref'

export type Pin = { kind: 'term' | 'course'; id: string }

export const samePin = (a: Pin, b: Pin) => a.kind === b.kind && a.id === b.id

/**
 * Terms and courses pinned to the sidebar, in the order shown (UI state
 * `academics.pinned.<programId>`).
 */
export function usePins(programId: string) {
  const [pins, setPins] = useUiPref<Pin[]>('academics.pinned', [], { scope: programId })
  const isPinned = (pin: Pin) => pins.some((p) => samePin(p, pin))
  const toggle = (pin: Pin) =>
    setPins(isPinned(pin) ? pins.filter((p) => !samePin(p, pin)) : [...pins, pin])
  return { pins, setPins, isPinned, toggle }
}

/**
 * Moves the pin at `from` to `to` among the pins that are on screen (`shown`, in the order of
 * `pins`). Pins that are not shown (a deleted course, the current term) keep their own places.
 */
export function movePin(pins: readonly Pin[], shown: readonly Pin[], from: number, to: number) {
  const moved = shown.filter((_, i) => i !== from)
  const pin = shown[from]
  if (!pin || to < 0 || to >= shown.length) return [...pins]
  moved.splice(to, 0, pin)
  let next = 0
  return pins.map((p) => (shown.some((s) => samePin(s, p)) ? moved[next++]! : p))
}
