import type { CounterSettings } from './schema'

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** The count to show: the stored one kept inside the range, or the start value. */
export function currentValue(s: CounterSettings): number {
  return clamp(s.value ?? s.initial, s.min, s.max)
}

/** One step up or down; the count stops at the ends of the range. */
export function stepped(s: CounterSettings, direction: 1 | -1): number {
  return clamp(currentValue(s) + direction * s.step, s.min, s.max)
}

/** 0–1 position of the count in the range. */
export function ratio(s: CounterSettings): number {
  return (currentValue(s) - s.min) / (s.max - s.min)
}

export type SettingsProblem = 'range' | 'step' | 'initial' | null

export function problemOf(
  s: Pick<CounterSettings, 'min' | 'max' | 'step' | 'initial'>,
): SettingsProblem {
  if (!(s.min < s.max)) return 'range'
  if (!(s.step >= 1)) return 'step'
  if (s.initial < s.min || s.initial > s.max) return 'initial'
  return null
}

/**
 * Applies a settings edit. When the range moved past the current count, the count follows the
 * range and `clampedTo` says so, for the form to tell the user.
 */
export function applyEdit(
  current: CounterSettings,
  patch: Partial<CounterSettings>,
): { settings: CounterSettings; clampedTo: number | null } {
  const next = { ...current, ...patch }
  if (problemOf(next)) return { settings: next, clampedTo: null }
  const before = current.value ?? current.initial
  const after = clamp(before, next.min, next.max)
  return {
    settings: { ...next, value: after },
    clampedTo: after !== before ? after : null,
  }
}
