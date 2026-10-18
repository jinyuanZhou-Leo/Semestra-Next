import { getLocale } from '@/paraglide/runtime'

/** "in 25 minutes" / "in 2 hours" for a start time after `now`. */
export function countdown(startAt: string, now: number): string {
  const diff = Math.max(0, new Date(startAt).getTime() - now)
  const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' })
  const minutes = Math.round(diff / 60_000)
  if (minutes < 60) return rtf.format(minutes, 'minute')
  const hours = Math.round(minutes / 6) / 10
  if (hours < 24) return rtf.format(Math.round(hours), 'hour')
  return rtf.format(Math.round(hours / 24), 'day')
}
