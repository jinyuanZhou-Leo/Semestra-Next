import { useNow } from '@/hooks/use-now'

/** Whole seconds left until `until` (epoch ms); re-renders once a second until it reaches 0. */
export function useCountdown(until: number): number {
  const now = useNow(1000, (at) => at < until)
  return Math.max(0, Math.ceil((until - now) / 1000))
}
