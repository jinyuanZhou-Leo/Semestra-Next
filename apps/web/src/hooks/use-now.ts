import { useEffect, useRef, useState } from 'react'

const always = () => true

/**
 * The current time (ms), refreshed every `everyMs` while `active(now)` holds (by default always),
 * for "now" lines, relative times and countdowns. Stops ticking once `active` turns false, so a
 * finished countdown no longer re-renders.
 */
export function useNow(everyMs = 60_000, active: (now: number) => boolean = always): number {
  const [now, setNow] = useState(() => Date.now())
  const ticking = active(now)
  const started = useRef(false)
  useEffect(() => {
    if (!ticking) return
    const update = () => setNow(Date.now())
    // Ticking again after a pause (a new countdown): catch up at once, not a tick later.
    const resume = started.current ? window.setTimeout(update, 0) : undefined
    started.current = true
    const timer = window.setInterval(update, everyMs)
    return () => {
      window.clearTimeout(resume)
      window.clearInterval(timer)
    }
  }, [ticking, everyMs])
  return now
}
