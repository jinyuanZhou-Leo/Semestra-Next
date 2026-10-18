import { useEffect, useState } from 'react'
import { useProgram } from '@/modules/academics/queries'

/** The current time, refreshed every `intervalMs` (for "now" lines and countdowns). */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

/** The Program's time zone; calendar times are always shown in it (M04 §2). */
export function useProgramTimezone(programId: string): string | undefined {
  return useProgram(programId).data?.timezone
}
