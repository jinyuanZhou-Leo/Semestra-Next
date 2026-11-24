import type { Occurrence } from '@semestra/api-client'

export function endOf(o: Occurrence): number {
  return new Date(o.end_at ?? o.start_at).getTime()
}

/**
 * Where the now line sits: inside the class in progress, in proportion to how much of it has
 * passed (as in the calendar), else at the top of the next timed item, or at the bottom of the
 * last one once all are over. `at` is the share of that row's height from its top.
 */
export function nowLine(
  items: readonly Occurrence[],
  now: number,
): { index: number; at: number } | null {
  const running = items.findIndex(
    (o) => !o.all_day && new Date(o.start_at).getTime() <= now && now < endOf(o),
  )
  const current = items[running]
  if (current) {
    const start = new Date(current.start_at).getTime()
    return { index: running, at: (now - start) / (endOf(current) - start) }
  }
  const upcoming = items.findIndex((o) => !o.all_day && endOf(o) > now)
  if (upcoming !== -1) return { index: upcoming, at: 0 }
  const last = items.findLastIndex((o) => !o.all_day)
  return last === -1 ? null : { index: last, at: 1 }
}
