import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'
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

/** "HH:MM" of a wall-clock `Date`. */
export function hhmm(local: Date): string {
  return format(local, 'HH:mm')
}

/** Today's date in `tz`. */
export function todayIn(tz: string): string {
  return format(new TZDate(Date.now(), tz), 'yyyy-MM-dd')
}

/** Localized weekday name; `weekday` is 1 = Monday … 7 = Sunday. */
export function weekdayName(weekday: number, width: 'long' | 'short' | 'narrow' = 'long'): string {
  // 2024-01-01 was a Monday.
  const date = new Date(2024, 0, weekday)
  return intl(Intl.DateTimeFormat, { weekday: width }).format(date)
}
