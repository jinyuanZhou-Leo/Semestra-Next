import { format, isValid, parse } from 'date-fns'

/**
 * Calendar days as the API sends them (`yyyy-MM-dd`) and the browser-local `Date`s that pickers
 * work with, via date-fns.
 */

/** `yyyy-MM-dd` of a browser-local `Date`. */
export function isoDay(local: Date): string {
  return format(local, 'yyyy-MM-dd')
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
