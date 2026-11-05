import { useEffect, useState } from 'react'

/** The current time (ms), ticking every `everyMs` while `tick(now)` holds. */
export function useNow(tick: (now: number) => boolean, everyMs = 500): number {
  const [now, setNow] = useState(() => Date.now())
  const ticking = tick(now)
  useEffect(() => {
    if (!ticking) return
    const timer = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(timer)
  }, [ticking, everyMs])
  return now
}
