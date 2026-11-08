import { TZDate } from '@date-fns/tz'
import { addDays, format } from 'date-fns'
import { isoDay } from '@/lib/day'
import { intl } from '@/lib/format'

/**
 * Calendar times are shown in the Program's time zone, whatever the browser's is (M04 §2).
 * FullCalendar works in browser-local `Date`s, so it is fed the Program's wall-clock times as
 * naive ISO strings ("2026-03-02T10:00:00") and its `Date`s are read back the same way.
 */

const WALL = "yyyy-MM-dd'T'HH:mm:ss"

/** UTC instant → wall-clock time in `tz`, as a naive ISO string. */
export function toWall(iso: string, tz: string): string {
  return format(new TZDate(iso, tz), WALL)
}

/** A browser-local `Date` (FullCalendar's) as the naive ISO wall-clock string it holds. */
export function wall(local: Date): string {
  return format(local, WALL)
}

/** The calendar day of an instant in `tz`, as `yyyy-MM-dd`. */
export function wallDate(iso: string, tz: string): string {
  return format(new TZDate(iso, tz), 'yyyy-MM-dd')
}

/** A `yyyy-MM-dd` day as a browser-local midnight `Date`. */
export function localDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

export function plusDays(day: string, days: number): string {
  return isoDay(addDays(localDay(day), days))
}

/** "HH:MM" of a wall-clock `Date`. */
export function hhmm(local: Date): string {
  return format(local, 'HH:mm')
}

/** Today's date in `tz`. */
export function todayIn(tz: string): string {
  return format(new TZDate(Date.now(), tz), 'yyyy-MM-dd')
}

/** Localized weekday name; `weekday` is 1 = Monday … 7 = Sunday. */
export function weekdayName(weekday: number, width: 'long' | 'short' = 'long'): string {
  // 2024-01-01 was a Monday.
  const date = new Date(2024, 0, weekday)
  return intl(Intl.DateTimeFormat, { weekday: width }).format(date)
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a `Date`. */
export function isoWeekday(local: Date): number {
  return local.getDay() === 0 ? 7 : local.getDay()
}

/** The first day of the week that contains `day`; `first` is 1 (Monday) or 7 (Sunday). */
export function weekStartOf(day: string, first: 1 | 7): string {
  const offset = (isoWeekday(localDay(day)) - first + 7) % 7
  return plusDays(day, -offset)
}

/** The date of `weekday` (1–7) in the week starting on `weekStart`. */
export function dayInWeek(weekStart: string, weekday: number): string {
  const offset = (weekday - isoWeekday(localDay(weekStart)) + 7) % 7
  return plusDays(weekStart, offset)
}
