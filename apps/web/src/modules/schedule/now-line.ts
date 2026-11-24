import type { Occurrence } from '@semestra/api-client'

export function endOf(o: Occurrence): number {
  return new Date(o.end_at ?? o.start_at).getTime()
}

/** Where the now line sits in a row: `at` is the share of the row's height from its top. */
export type NowLinePlace = { index: number; at: number }

/**
 * Where the now line goes in today's list (desktop card and phone page alike). Inside every class
 * in progress, in proportion to how much of it has passed (overlapping classes each get one, as in
 * the calendar); cancelled ones don't count, as for the countdown. With none in progress it sits
 * at the top of the next timed item, or at the bottom of the last one once all are over.
 */
export function nowLine(items: readonly Occurrence[], now: number): NowLinePlace[] {
  const running = items.flatMap((o, index) => {
    const start = new Date(o.start_at).getTime()
    if (o.all_day || o.status === 'cancelled' || start > now || now >= endOf(o)) return []
    return [{ index, at: (now - start) / (endOf(o) - start) }]
  })
  if (running.length > 0) return running
  const upcoming = items.findIndex((o) => !o.all_day && o.status !== 'cancelled' && endOf(o) > now)
  if (upcoming !== -1) return [{ index: upcoming, at: 0 }]
  const last = items.findLastIndex((o) => !o.all_day)
  return last === -1 ? [] : [{ index: last, at: 1 }]
}
