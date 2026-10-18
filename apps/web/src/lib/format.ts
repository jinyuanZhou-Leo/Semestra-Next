import { getLocale } from '@/paraglide/runtime'

/**
 * Locale-aware formatting (M00 §4.5). Always format through these helpers, never by hand.
 * The clock format and first day of the week follow the user's preferences (M11); an explicit
 * `hour12` option overrides the clock preference for one call.
 */

export type FormatPreferences = {
  timeFormat: 'auto' | '12h' | '24h'
  /** 1 = Monday, 7 = Sunday, 0 = follow the language. */
  weekStart: 0 | 1 | 7
}

let preferences: FormatPreferences = { timeFormat: 'auto', weekStart: 0 }

export function getFormatPreferences(): FormatPreferences {
  return preferences
}

/** Set by `PreferencesSync` once the user's preferences are known. */
export function setFormatPreferences(next: FormatPreferences) {
  preferences = next
}

function hourCycle(opts: { hour12?: boolean }): { hourCycle?: 'h12' | 'h23' } {
  const hour12 =
    opts.hour12 ??
    (preferences.timeFormat === 'auto' ? undefined : preferences.timeFormat === '12h')
  // `hourCycle` instead of `hour12: false`, which prints midnight as "24:00" in some locales.
  return hour12 === undefined ? {} : { hourCycle: hour12 ? 'h12' : 'h23' }
}

/** The first day of the week as 1 (Monday) … 7 (Sunday). */
export function firstDayOfWeek(): 1 | 7 {
  if (preferences.weekStart !== 0) return preferences.weekStart
  return getLocale().startsWith('zh') ? 1 : 7
}

export function formatDateTime(value: string | Date, opts: { hour12?: boolean } = {}): string {
  return new Intl.DateTimeFormat(getLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...hourCycle(opts),
  }).format(new Date(value))
}

export function formatDate(value: string | Date): string {
  return new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium' }).format(new Date(value))
}

/** A time of day: a Date, an ISO timestamp, or a local `HH:MM[:SS]` from the API. */
export function formatTime(value: string | Date, opts: { hour12?: boolean } = {}): string {
  const date =
    typeof value === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(value)
      ? new Date(`1970-01-01T${value}`)
      : new Date(value)
  return new Intl.DateTimeFormat(getLocale(), { timeStyle: 'short', ...hourCycle(opts) }).format(
    date,
  )
}

/** `ratio` is a fraction: 0.875 → "87.5%". */
export function formatPercent(ratio: number, maxFractionDigits = 1): string {
  return new Intl.NumberFormat(getLocale(), {
    style: 'percent',
    maximumFractionDigits: maxFractionDigits,
  }).format(ratio)
}

export function formatGpa(value: number, fractionDigits = 2): string {
  return new Intl.NumberFormat(getLocale(), {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)
}

export function formatCredits(value: number): string {
  return new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 2 }).format(value)
}

export function formatBytes(bytes: number): string {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return new Intl.NumberFormat(getLocale(), {
    style: 'unit',
    unit: units[unit],
    unitDisplay: 'short',
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value)
}
