import { getFormatPreferences } from '@/lib/format'
import enZoneNames from './zone-names.en.json'
import zhZoneNames from './zone-names.zh.json'

// Unicode CLDR exemplar cities (cldr-dates-full, timeZoneNames.json), see zone-names.*.json.
const enNames: Record<string, string> = enZoneNames
const zhNames: Record<string, string> = zhZoneNames

/**
 * Time zone choices for the world clock (M14 §5). Zones are IANA ids; people search by city, in
 * English or Chinese. The Chinese names cover the cities students most often ask for; every other
 * zone is found by its English city name taken from the id.
 */

type City = { tz: string; en: string; zh: string }

const CITIES: readonly City[] = [
  { tz: 'America/Toronto', en: 'Toronto', zh: '多伦多' },
  { tz: 'America/Vancouver', en: 'Vancouver', zh: '温哥华' },
  { tz: 'America/Edmonton', en: 'Edmonton', zh: '埃德蒙顿' },
  { tz: 'America/Winnipeg', en: 'Winnipeg', zh: '温尼伯' },
  { tz: 'America/Halifax', en: 'Halifax', zh: '哈利法克斯' },
  { tz: 'America/St_Johns', en: "St. John's", zh: '圣约翰斯' },
  { tz: 'America/New_York', en: 'New York', zh: '纽约' },
  { tz: 'America/Chicago', en: 'Chicago', zh: '芝加哥' },
  { tz: 'America/Denver', en: 'Denver', zh: '丹佛' },
  { tz: 'America/Los_Angeles', en: 'Los Angeles', zh: '洛杉矶' },
  { tz: 'America/Phoenix', en: 'Phoenix', zh: '凤凰城' },
  { tz: 'America/Anchorage', en: 'Anchorage', zh: '安克雷奇' },
  { tz: 'Pacific/Honolulu', en: 'Honolulu', zh: '檀香山' },
  { tz: 'America/Mexico_City', en: 'Mexico City', zh: '墨西哥城' },
  { tz: 'America/Bogota', en: 'Bogotá', zh: '波哥大' },
  { tz: 'America/Lima', en: 'Lima', zh: '利马' },
  { tz: 'America/Sao_Paulo', en: 'São Paulo', zh: '圣保罗' },
  { tz: 'America/Argentina/Buenos_Aires', en: 'Buenos Aires', zh: '布宜诺斯艾利斯' },
  { tz: 'Atlantic/Reykjavik', en: 'Reykjavik', zh: '雷克雅未克' },
  { tz: 'Europe/London', en: 'London', zh: '伦敦' },
  { tz: 'Europe/Dublin', en: 'Dublin', zh: '都柏林' },
  { tz: 'Europe/Lisbon', en: 'Lisbon', zh: '里斯本' },
  { tz: 'Europe/Paris', en: 'Paris', zh: '巴黎' },
  { tz: 'Europe/Berlin', en: 'Berlin', zh: '柏林' },
  { tz: 'Europe/Madrid', en: 'Madrid', zh: '马德里' },
  { tz: 'Europe/Rome', en: 'Rome', zh: '罗马' },
  { tz: 'Europe/Amsterdam', en: 'Amsterdam', zh: '阿姆斯特丹' },
  { tz: 'Europe/Zurich', en: 'Zurich', zh: '苏黎世' },
  { tz: 'Europe/Stockholm', en: 'Stockholm', zh: '斯德哥尔摩' },
  { tz: 'Europe/Warsaw', en: 'Warsaw', zh: '华沙' },
  { tz: 'Europe/Athens', en: 'Athens', zh: '雅典' },
  { tz: 'Europe/Istanbul', en: 'Istanbul', zh: '伊斯坦布尔' },
  { tz: 'Europe/Moscow', en: 'Moscow', zh: '莫斯科' },
  { tz: 'Africa/Cairo', en: 'Cairo', zh: '开罗' },
  { tz: 'Africa/Lagos', en: 'Lagos', zh: '拉各斯' },
  { tz: 'Africa/Nairobi', en: 'Nairobi', zh: '内罗毕' },
  { tz: 'Africa/Johannesburg', en: 'Johannesburg', zh: '约翰内斯堡' },
  { tz: 'Asia/Dubai', en: 'Dubai', zh: '迪拜' },
  { tz: 'Asia/Tehran', en: 'Tehran', zh: '德黑兰' },
  { tz: 'Asia/Karachi', en: 'Karachi', zh: '卡拉奇' },
  { tz: 'Asia/Kolkata', en: 'Kolkata', zh: '加尔各答' },
  { tz: 'Asia/Dhaka', en: 'Dhaka', zh: '达卡' },
  { tz: 'Asia/Bangkok', en: 'Bangkok', zh: '曼谷' },
  { tz: 'Asia/Ho_Chi_Minh', en: 'Ho Chi Minh City', zh: '胡志明市' },
  { tz: 'Asia/Jakarta', en: 'Jakarta', zh: '雅加达' },
  { tz: 'Asia/Singapore', en: 'Singapore', zh: '新加坡' },
  { tz: 'Asia/Kuala_Lumpur', en: 'Kuala Lumpur', zh: '吉隆坡' },
  { tz: 'Asia/Manila', en: 'Manila', zh: '马尼拉' },
  { tz: 'Asia/Hong_Kong', en: 'Hong Kong', zh: '香港' },
  { tz: 'Asia/Shanghai', en: 'Shanghai', zh: '上海' },
  { tz: 'Asia/Shanghai', en: 'Beijing', zh: '北京' },
  { tz: 'Asia/Taipei', en: 'Taipei', zh: '台北' },
  { tz: 'Asia/Seoul', en: 'Seoul', zh: '首尔' },
  { tz: 'Asia/Tokyo', en: 'Tokyo', zh: '东京' },
  { tz: 'Australia/Perth', en: 'Perth', zh: '珀斯' },
  { tz: 'Australia/Sydney', en: 'Sydney', zh: '悉尼' },
  { tz: 'Australia/Melbourne', en: 'Melbourne', zh: '墨尔本' },
  { tz: 'Australia/Brisbane', en: 'Brisbane', zh: '布里斯班' },
  { tz: 'Pacific/Auckland', en: 'Auckland', zh: '奥克兰' },
  { tz: 'UTC', en: 'UTC', zh: '协调世界时' },
]

export type ZoneOption = { tz: string; label: string }

function isChinese(locale: string) {
  return locale.startsWith('zh')
}

/** "America/Argentina/Buenos_Aires" → "Buenos Aires". */
function cityOfId(tz: string): string {
  return (tz.split('/').pop() ?? tz).replaceAll('_', ' ')
}

/**
 * The city name to show for a zone, in the interface language. CLDR's exemplar city names cover
 * every IANA zone in Chinese and fix the English spelling where it differs from the id
 * ("Kyiv", "Chișinău"); the curated list is only a fallback.
 */
export function zoneLabel(tz: string, locale: string): string {
  const chinese = isChinese(locale)
  const cldr = (chinese ? zhNames : enNames)[tz]
  if (cldr) return cldr
  const city = CITIES.find((c) => c.tz === tz)
  if (city) return chinese ? city.zh : city.en
  return cityOfId(tz)
}

/** Every name a zone is searched by, lower-cased: id, both languages, curated aliases. */
export function zoneSearchNames(tz: string): string {
  const names = CITIES.filter((c) => c.tz === tz).flatMap((c) => [c.en, c.zh])
  return [cityOfId(tz), enNames[tz], zhNames[tz], ...names].filter(Boolean).join(' ').toLowerCase()
}

export function isValidZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

function allZones(): string[] {
  const supported = (
    Intl as unknown as { supportedValuesOf?: (key: 'timeZone') => string[] }
  ).supportedValuesOf?.('timeZone')
  return supported ?? CITIES.map((c) => c.tz)
}

function normalize(text: string) {
  return text.toLowerCase().replaceAll('_', ' ').replace(/\s+/g, ' ').trim()
}

/** Zones matching `query` by city (English or Chinese) or id; the curated cities come first. */
export function searchZones(query: string, locale: string, limit = 8): ZoneOption[] {
  const needle = normalize(query)
  if (!needle) return []
  const seen = new Set<string>()
  const out: ZoneOption[] = []
  const add = (tz: string, label: string) => {
    if (out.length >= limit || seen.has(`${tz}|${label}`)) return
    seen.add(`${tz}|${label}`)
    out.push({ tz, label })
  }
  const score = (text: string) => (text.startsWith(needle) ? 0 : text.includes(needle) ? 1 : 2)
  const curated = CITIES.filter(
    (c) =>
      score(normalize(c.en)) < 2 || c.zh.includes(query.trim()) || normalize(c.tz).includes(needle),
  ).sort((a, b) => score(normalize(a.en)) - score(normalize(b.en)))
  for (const city of curated) add(city.tz, isChinese(locale) ? city.zh : city.en)
  for (const tz of allZones()) {
    if (normalize(`${tz} ${enNames[tz] ?? ''} ${zhNames[tz] ?? ''}`).includes(needle))
      add(tz, zoneLabel(tz, locale))
  }
  return out
}

function hourCycle(): { hourCycle?: 'h12' | 'h23' } {
  const { timeFormat } = getFormatPreferences()
  return timeFormat === 'auto' ? {} : { hourCycle: timeFormat === '12h' ? 'h12' : 'h23' }
}

export function formatZoneTime(
  date: Date,
  tz: string,
  locale: string,
  options: { seconds?: boolean } = {},
): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    ...(options.seconds ? { second: '2-digit' as const } : {}),
    ...hourCycle(),
  }).format(date)
}

export function formatZoneDate(date: Date, tz: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

/** UTC offset of `tz` at `date`, in minutes (+330 for India). */
export function offsetMinutes(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'longOffset',
  }).formatToParts(date)
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'
  const match = /GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?/.exec(name)
  if (!match?.[1]) return 0
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0)
  return match[1] === '-' ? -minutes : minutes
}

/** How far ahead (+) or behind (−) `tz` is from `otherTz`, in minutes. */
export function offsetFrom(date: Date, tz: string, otherTz: string): number {
  return offsetMinutes(date, tz) - offsetMinutes(date, otherTz)
}

export function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}
