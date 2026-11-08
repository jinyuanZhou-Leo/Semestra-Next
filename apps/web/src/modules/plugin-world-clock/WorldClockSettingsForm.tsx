import { Search, X } from 'lucide-react'
import { useId, useState } from 'react'
import { SettingRow, SettingsBlock, SettingsGroup, SettingsNote } from '@/app/settings'
import { m } from '@/paraglide/messages'
import { getLocale } from '@/paraglide/runtime'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList } from '@/ui/combobox'
import { InputGroupAddon } from '@/ui/input-group'
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/ui/item'
import { Switch } from '@/ui/switch'
import { MAX_ZONES, type WorldClockSettings } from './schema'
import { searchZones, type ZoneOption, zoneLabel } from '@/lib/zones'

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
      <SettingsBlock title={m.world_clock_settings_zones_label()}>
        <SettingsGroup>
          {[
            ...value.zones.map((tz) => (
              <Item key={tz}>
                <ItemContent>
                  <ItemTitle>{zoneLabel(tz, locale)}</ItemTitle>
                  <ItemDescription>{tz}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    variant="destructive"
                    size="icon-sm"
                    aria-label={m.world_clock_settings_remove({ city: zoneLabel(tz, locale) })}
                    onClick={() =>
                      onChange({ ...value, zones: value.zones.filter((z) => z !== tz) })
                    }
                  >
                    <X aria-hidden />
                  </Button>
                </ItemActions>
              </Item>
            )),
            <Item key="search">
              <ItemContent>
                {/* Picking a city adds it and empties the search for the next one. */}
                <Combobox<ZoneOption>
                  items={results}
                  filter={null}
                  value={null}
                  inputValue={query}
                  onInputValueChange={setQuery}
                  onValueChange={(zone) => {
                    if (!zone) return
                    onChange({ ...value, zones: [...value.zones, zone.tz] })
                    setQuery('')
                  }}
                  itemToStringLabel={(zone) => zone.label}
                  isItemEqualToValue={(a, b) => a.tz === b.tz && a.label === b.label}
                  disabled={full}
                >
                  <ComboboxInput
                    showTrigger={false}
                    className="w-full"
                    aria-label={m.world_clock_settings_search_label()}
                    placeholder={m.world_clock_settings_search_placeholder()}
                    disabled={full}
                    aria-describedby={full ? `${id}-search-hint` : undefined}
                  >
                    <InputGroupAddon>
                      <Search aria-hidden />
                    </InputGroupAddon>
                  </ComboboxInput>
                  <ComboboxContent>
                    <ComboboxList aria-label={m.world_clock_settings_results()}>
                      {(zone: ZoneOption) => (
                        <ComboboxItem key={`${zone.tz}|${zone.label}`} value={zone}>
                          {zone.label}
                          <span className="ml-auto text-xs text-muted-foreground">{zone.tz}</span>
                        </ComboboxItem>
                      )}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              </ItemContent>
            </Item>,
          ]}
        </SettingsGroup>
        {full ? (
          <SettingsNote>
            <span id={`${id}-search-hint`}>{m.world_clock_settings_full({ max: MAX_ZONES })}</span>
          </SettingsNote>
        ) : null}
      </SettingsBlock>
      <SettingsGroup>
        <SettingRow
          key="label"
          label={m.world_clock_settings_label_label()}
          htmlFor={`${id}-label`}
        >
          <Input
            id={`${id}-label`}
            className="w-48"
            maxLength={60}
            placeholder={m.world_clock_settings_label_placeholder()}
            value={value.label ?? ''}
            onChange={(event) => onChange({ ...value, label: event.target.value || undefined })}
          />
        </SettingRow>
        <SettingRow key="seconds" label={m.world_clock_settings_show_seconds_label()}>
          {(labelId) => (
            <Switch
              aria-labelledby={labelId}
              checked={value.show_seconds}
              onCheckedChange={(show_seconds) => onChange({ ...value, show_seconds })}
            />
          )}
        </SettingRow>
        <SettingRow key="offset" label={m.world_clock_settings_show_offset_label()}>
          {(labelId) => (
            <Switch
              aria-labelledby={labelId}
              checked={value.show_offset}
              onCheckedChange={(show_offset) => onChange({ ...value, show_offset })}
            />
          )}
        </SettingRow>
      </SettingsGroup>
    </div>
  )
}
