import { useEffect, useState } from 'react'

/** Whole seconds left until `until` (epoch ms); re-renders once a second. */
export function useCountdown(until: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return Math.max(0, Math.ceil((until - now) / 1000))
}
