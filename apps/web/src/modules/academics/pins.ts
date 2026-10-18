import { useUiPref } from '@/app/ui-pref'

export type Pin = { kind: 'term' | 'course'; id: string }

/** Terms and courses pinned to the Program overview (UI state `academics.pinned.<programId>`). */
export function usePins(programId: string) {
  const [pins, setPins] = useUiPref<Pin[]>('academics.pinned', [], { scope: programId })
  const isPinned = (pin: Pin) => pins.some((p) => p.kind === pin.kind && p.id === pin.id)
  const toggle = (pin: Pin) =>
    setPins(
      isPinned(pin)
        ? pins.filter((p) => !(p.kind === pin.kind && p.id === pin.id))
        : [...pins, pin],
    )
  return { pins, setPins, isPinned, toggle }
}
