import { addDays, differenceInCalendarDays, format, isValid, parse } from 'date-fns'

/**
 * Calendar days as the API sends them (`yyyy-MM-dd`) and the browser-local `Date`s that pickers
 * and date-fns work with. All day arithmetic goes through here: local midnights and date-fns, so
 * a daylight-saving change never moves a day.
 */

/** `yyyy-MM-dd` of a browser-local `Date`. */
export function isoDay(local: Date): string {
  return format(local, 'yyyy-MM-dd')
}

/** A `yyyy-MM-dd` day (or the date part of a longer string) as a browser-local midnight `Date`. */
export function dayDate(day: string): Date {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

/** A `yyyy-MM-dd` day as a browser-local midnight `Date`, or undefined when it is not a real day. */
export function parseDay(value: string): Date | undefined {
  const date = parse(value, 'yyyy-MM-dd', new Date())
  return isValid(date) ? date : undefined
}

/** Today in the browser's time zone, as `yyyy-MM-dd`. */
export function todayDay(): string {
  return isoDay(new Date())
}

/** The day `days` after (or before, when negative) `day`. */
export function plusDays(day: string, days: number): string {
  return isoDay(addDays(dayDate(day), days))
}

/** Whole calendar days from `from` to `to` (negative when `to` comes first). */
export function daysBetween(from: string, to: string): number {
  return differenceInCalendarDays(dayDate(to), dayDate(from))
}

/** ISO weekday of a local `Date`: 1 = Monday … 7 = Sunday. */
export function isoWeekday(local: Date): number {
  return local.getDay() === 0 ? 7 : local.getDay()
}

/** The first day of the week that contains `day`; `first` is 1 (Monday) or 7 (Sunday). */
export function weekStartOf(day: string, first: 1 | 7): string {
  return plusDays(day, -((isoWeekday(dayDate(day)) - first + 7) % 7))
}

/** The date of `weekday` (1–7) in the week starting on `weekStart`. */
export function dayInWeek(weekStart: string, weekday: number): string {
  return plusDays(weekStart, (weekday - isoWeekday(dayDate(weekStart)) + 7) % 7)
}
