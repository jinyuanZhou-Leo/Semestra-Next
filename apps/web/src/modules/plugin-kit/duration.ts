import { intl } from '@/lib/format'

/** "1h 25m" / "25m" / "0m" for a span of seconds, in the interface language. */
export function formatSpan(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  const unit = (value: number, name: 'hour' | 'minute') =>
    intl(Intl.NumberFormat, { style: 'unit', unit: name, unitDisplay: 'narrow' }).format(value)
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return unit(rest, 'minute')
  return rest === 0 ? unit(hours, 'hour') : `${unit(hours, 'hour')} ${unit(rest, 'minute')}`
}
