import { useEffect, useState } from 'react'

/**
 * The current time, refreshed every second, or once a minute right on the minute (so a clock
 * without seconds changes when a wall clock would, not up to a minute late).
 */
export function useClock(seconds: boolean): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      const t = Date.now()
      const wait = seconds ? 1000 - (t % 1000) : 60_000 - (t % 60_000)
      timer = setTimeout(() => {
        setNow(new Date())
        schedule()
      }, wait + 5)
    }
    schedule()
    return () => clearTimeout(timer)
  }, [seconds])
  return now
}
