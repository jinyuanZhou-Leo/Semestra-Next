import { useLocale } from '@/app/locale'
import { offsetMinutes, zoneLabel, zoneSearchNames } from '@/lib/zones'
import { m } from '@/paraglide/messages'
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from '@/ui/combobox'

/** The browser's time zone, e.g. 'America/Toronto' (the default for a new Program). */
export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

type Zone = { value: string; label: string; offset: string; search: string }
type ZoneGroup = { value: string; items: Zone[] }

function zones(current: string): string[] {
  let all: string[] = []
  try {
    all = Intl.supportedValuesOf('timeZone')
  } catch {
    // Older engines: offer at least the current value.
  }
  return all.includes(current) ? all : [current, ...all]
}

/** "UTC−4", "UTC+5:30". */
function formatOffset(minutes: number): string {
  if (minutes === 0) return 'UTC'
  const abs = Math.abs(minutes)
  const rest = abs % 60
  return `UTC${minutes < 0 ? '−' : '+'}${Math.floor(abs / 60)}${rest ? `:${String(rest).padStart(2, '0')}` : ''}`
}

function toZone(tz: string, locale: string, now: Date): Zone {
  const label = zoneLabel(tz, locale)
  return {
    value: tz,
    label,
    offset: formatOffset(offsetMinutes(now, tz)),
    // Both languages and the id are searchable, whichever language the interface is in.
    search: `${tz.toLowerCase()} ${tz.replaceAll('_', ' ').toLowerCase()} ${zoneSearchNames(tz)}`,
  }
}

function buildGroups(current: string, locale: string): { groups: ZoneGroup[]; all: Zone[] } {
  const now = new Date()
  const browser = detectTimezone()
  const regions = new Map<string, Zone[]>()
  for (const tz of zones(current)) {
    if (tz === browser) continue
    const region = tz.includes('/') ? tz.slice(0, tz.indexOf('/')) : 'Other'
    const list = regions.get(region) ?? []
    list.push(toZone(tz, locale, now))
    regions.set(region, list)
  }
  const groups: ZoneGroup[] = [
    { value: m.academics_timezone_browser(), items: [toZone(browser, locale, now)] },
    ...[...regions].map(([value, items]) => ({ value, items })),
  ]
  return { groups, all: groups.flatMap((g) => g.items) }
}

export function TimezoneSelect({
  id,
  value,
  onChange,
  ...aria
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  'aria-labelledby'?: string
  'aria-label'?: string
}) {
  const { locale } = useLocale()
  const { groups, all } = buildGroups(value, locale)
  const selected = all.find((zone) => zone.value === value) ?? null
  return (
    <Combobox
      items={groups}
      value={selected}
      onValueChange={(next) => next && onChange(next.value)}
      itemToStringLabel={(zone) => `${zone.label} (${zone.offset})`}
      isItemEqualToValue={(a, b) => a.value === b.value}
      filter={(zone, query) => zone.search.includes(query.trim().toLowerCase())}
    >
      <ComboboxInput
        id={id}
        className="w-72"
        placeholder={m.academics_timezone_search()}
        {...aria}
      />
      <ComboboxContent>
        <ComboboxEmpty>{m.academics_timezone_empty()}</ComboboxEmpty>
        <ComboboxList>
          {(group: ZoneGroup) => (
            <ComboboxGroup key={group.value} items={group.items}>
              <ComboboxLabel>{group.value}</ComboboxLabel>
              <ComboboxCollection>
                {(zone: Zone) => (
                  <ComboboxItem key={zone.value} value={zone}>
                    {zone.label}
                    <span className="ml-auto text-xs text-muted-foreground">{zone.offset}</span>
                  </ComboboxItem>
                )}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
