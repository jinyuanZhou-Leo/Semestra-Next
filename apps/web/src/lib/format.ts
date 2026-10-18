import { getLocale } from '@/paraglide/runtime'

/**
 * Locale-aware formatting (M00 §4.5). Always format through these helpers, never by hand.
 * `hour12` comes from the user's preference (M11); undefined follows the locale.
 */

export function formatDateTime(value: string | Date, opts: { hour12?: boolean } = {}): string {
  return new Intl.DateTimeFormat(getLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: opts.hour12,
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
  return new Intl.DateTimeFormat(getLocale(), { timeStyle: 'short', hour12: opts.hour12 }).format(
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
