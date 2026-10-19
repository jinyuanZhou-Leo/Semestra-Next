import type { EventType, Occurrence } from '@semestra/api-client'
import { formatDate } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { getLocale } from '@/paraglide/runtime'
import { localDay } from './time'

const BUILTIN_NAMES: Record<string, () => string> = {
  LEC: m.schedule_type_lec,
  PRA: m.schedule_type_pra,
  TUT: m.schedule_type_tut,
}

/** Built-in types are named in the user's language; custom ones as the user named them. */
export function typeName(type: Pick<EventType, 'code' | 'name' | 'builtin'>): string {
  const builtin = type.builtin ? BUILTIN_NAMES[type.code] : undefined
  return builtin ? builtin() : type.name
}

export function weekLabel(number: number | null | undefined, breakName?: string | null): string {
  if (number != null) return m.schedule_week_number({ number })
  return breakName ?? ''
}

/** "10:00 – 11:00" in the Program's time zone; "All day" for all-day items. */
export function timeRange(
  o: Pick<Occurrence, 'start_at' | 'end_at' | 'all_day'>,
  tz: string,
): string {
  if (o.all_day) return m.schedule_all_day()
  const fmt = new Intl.DateTimeFormat(getLocale(), { timeStyle: 'short', timeZone: tz })
  const start = fmt.format(new Date(o.start_at))
  if (!o.end_at || o.end_at === o.start_at) return start
  return `${start} – ${fmt.format(new Date(o.end_at))}`
}

export function dayLabel(day: string): string {
  return new Intl.DateTimeFormat(getLocale(), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(localDay(day))
}

export function longDayLabel(day: string): string {
  return new Intl.DateTimeFormat(getLocale(), { dateStyle: 'full' }).format(localDay(day))
}

export { formatDate }
