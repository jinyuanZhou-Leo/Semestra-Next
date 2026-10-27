import type { EventType, Meeting, Occurrence } from '@semestra/api-client'
import { m } from '@/paraglide/messages'
import { intl } from '@/lib/format'
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
  const fmt = intl(Intl.DateTimeFormat, { timeStyle: 'short', timeZone: tz })
  const start = fmt.format(new Date(o.start_at))
  if (!o.end_at || o.end_at === o.start_at) return start
  return `${start} – ${fmt.format(new Date(o.end_at))}`
}

export function dayLabel(day: string): string {
  return intl(Intl.DateTimeFormat, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(localDay(day))
}

export function longDayLabel(day: string): string {
  return intl(Intl.DateTimeFormat, { dateStyle: 'full' }).format(localDay(day))
}

/** A meeting named by its section: "LEC0101", or "TUT 2" when the code doesn't carry the type. */
export function sectionLabel(meeting: Pick<Meeting, 'type_code' | 'section_code'>): string {
  return meeting.section_code.startsWith(meeting.type_code)
    ? meeting.section_code
    : `${meeting.type_code} ${meeting.section_code}`.trim()
}
