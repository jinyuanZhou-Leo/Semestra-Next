import { X } from 'lucide-react'
import { useId, useState } from 'react'
import { SettingList, SettingRow } from '@/components/SettingRow'
import { TextField } from '@/components/TextField'
import { m } from '@/paraglide/messages'
import { getLocale } from '@/paraglide/runtime'
import { Button } from '@/ui/button'
import { Switch } from '@/ui/switch'
import { MAX_ZONES, type WorldClockSettings } from './schema'
import { searchZones, zoneLabel } from './zones'

type Props = { value: WorldClockSettings; onChange: (value: WorldClockSettings) => void }

/** Settings form of the world clock: pick up to three zones by searching for a city. */
export default function WorldClockSettingsForm({ value, onChange }: Props) {
  const id = useId()
  const [query, setQuery] = useState('')
  const locale = getLocale()
  const full = value.zones.length >= MAX_ZONES
  const results = full ? [] : searchZones(query, locale).filter((z) => !value.zones.includes(z.tz))

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-sm font-medium">{m.world_clock_settings_zones_label()}</p>
        <ul className="mb-2 flex flex-wrap gap-2">
          {value.zones.map((tz) => (
            <li
              key={tz}
              className="flex items-center gap-1 rounded-4xl bg-muted py-1 pr-1 pl-3 text-sm"
            >
              {zoneLabel(tz, locale)}
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={m.world_clock_settings_remove({ city: zoneLabel(tz, locale) })}
                onClick={() => onChange({ ...value, zones: value.zones.filter((z) => z !== tz) })}
              >
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
        <TextField
          label={m.world_clock_settings_search_label()}
          placeholder={m.world_clock_settings_search_placeholder()}
          disabled={full}
          hint={full ? m.world_clock_settings_full({ max: MAX_ZONES }) : undefined}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {results.length > 0 ? (
          <ul
            aria-label={m.world_clock_settings_results()}
            className="mt-2 divide-y divide-border rounded-2xl border border-border"
          >
            {results.map((zone) => (
              <li key={`${zone.tz}|${zone.label}`}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    onChange({ ...value, zones: [...value.zones, zone.tz] })
                    setQuery('')
                  }}
                >
                  {zone.label}
                  <span className="text-xs text-muted-foreground">{zone.tz}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <TextField
        label={m.world_clock_settings_label_label()}
        maxLength={60}
        value={value.label ?? ''}
        onChange={(event) => onChange({ ...value, label: event.target.value || undefined })}
      />
      <SettingList>
        <SettingRow label={m.world_clock_settings_show_seconds_label()} labelId={`${id}-seconds`}>
          <Switch
            aria-labelledby={`${id}-seconds`}
            checked={value.show_seconds}
            onCheckedChange={(show_seconds) => onChange({ ...value, show_seconds })}
          />
        </SettingRow>
        <SettingRow label={m.world_clock_settings_show_offset_label()} labelId={`${id}-offset`}>
          <Switch
            aria-labelledby={`${id}-offset`}
            checked={value.show_offset}
            onCheckedChange={(show_offset) => onChange({ ...value, show_offset })}
          />
        </SettingRow>
      </SettingList>
    </div>
  )
}
