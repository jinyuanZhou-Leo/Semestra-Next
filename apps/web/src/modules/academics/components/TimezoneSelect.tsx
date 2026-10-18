import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'

/** The browser's time zone, e.g. 'America/Toronto' (the default for a new Program). */
export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

function zones(current: string): string[] {
  let all: string[] = []
  try {
    all = Intl.supportedValuesOf('timeZone')
  } catch {
    // Older engines: offer at least the current value.
  }
  return all.includes(current) ? all : [current, ...all]
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
  const items = zones(value).map((zone) => ({ value: zone, label: zone.replaceAll('_', ' ') }))
  return (
    <Select value={value} items={items} onValueChange={(next) => next && onChange(String(next))}>
      <SelectTrigger id={id} className="w-64" {...aria}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
