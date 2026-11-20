import { useNow } from '@/hooks/use-now'
import { useUiPref } from '../ui-pref'

/**
 * The rules every status line follows (M10 §5.6), in one place. The host applies two of them
 * itself: a line stays (with its panel) while its panel is open, and the failures a line lists in
 * its panel (`StatusItem.failures`) count as seen once that panel closes. Lines read the seen
 * failures and the "done" window from here.
 */

/** How long something that ended well still shows. */
export const DONE_VISIBLE_MS = 15_000

/** Failures seen in a panel, newest first, for every line (they are job ids, unique across lines). */
const SEEN_KEY = 'layout.status_seen_failures'
/** Enough for a few rounds of a large sync. */
const SEEN_KEPT = 500

/** The failures the user has seen in a status line's panel: the line stops reporting them. */
export function useSeenFailures(): readonly string[] {
  return useUiPref<string[]>(SEEN_KEY, [])[0]
}

/** Marks failures as seen (the host does it when a panel that listed them closes). */
export function useMarkSeen(): (ids: readonly string[]) => void {
  const [seen, setSeen] = useUiPref<string[]>(SEEN_KEY, [])
  return (ids) => {
    const fresh = ids.filter((id) => !seen.includes(id))
    if (fresh.length > 0) setSeen([...fresh, ...seen].slice(0, SEEN_KEPT))
  }
}

/** Whether something that ended well at `end` (ms) still shows at `now`. */
export const endedLately = (end: number, now: number) => now - end < DONE_VISIBLE_MS

/**
 * The time for `endedLately`, kept current while one of `ends` (what the line may show as done,
 * in ms) is still within `DONE_VISIBLE_MS`, so the line updates when the last of them runs out.
 */
export function useDoneClock(ends: readonly number[]): number {
  return useNow(1000, (now) => ends.some((end) => endedLately(end, now)))
}
