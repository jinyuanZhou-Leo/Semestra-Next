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

const AGO_UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 86_400],
  ['month', 30 * 86_400],
  ['week', 7 * 86_400],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
]

/** "5 minutes ago", "yesterday", "just now": a past moment in its largest whole unit. */
export function formatTimeAgo(value: string | Date, now: number = Date.now()): string {
  const seconds = Math.max(0, (now - new Date(value).getTime()) / 1000)
  const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' })
  for (const [unit, size] of AGO_UNITS) {
    if (seconds >= size) return rtf.format(-Math.floor(seconds / size), unit)
  }
  return rtf.format(0, 'second')
}

/**
 * A calendar day: a Date, an ISO timestamp, or a date-only `YYYY-MM-DD` from the API. `short`
 * leaves out the year ("Jan 15"), for chart axes and labels within one recent range.
 */
export function formatDate(value: string | Date, opts: { short?: boolean } = {}): string {
  // `new Date('2026-01-15')` is midnight UTC, which west of Greenwich is still the 14th locally:
  // a date without a time is a calendar day and keeps its own day.
  const calendarDay = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  return new Intl.DateTimeFormat(getLocale(), {
    ...(opts.short ? { month: 'short', day: 'numeric' } : { dateStyle: 'medium' }),
    ...(calendarDay ? { timeZone: 'UTC' } : {}),
  }).format(new Date(value))
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

/** A count; `compact` writes large numbers short ("12K", "1.2万"). */
export function formatCount(value: number, opts: { compact?: boolean } = {}): string {
  return new Intl.NumberFormat(getLocale(), {
    notation: opts.compact ? 'compact' : 'standard',
    maximumFractionDigits: opts.compact ? 1 : 0,
  }).format(value)
}

/** An amount in US dollars (provider prices); small amounts keep enough digits to be non-zero. */
export function formatUsd(value: number): string {
  return new Intl.NumberFormat(getLocale(), {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: value !== 0 && Math.abs(value) < 0.01 ? 4 : 2,
  }).format(value)
}
