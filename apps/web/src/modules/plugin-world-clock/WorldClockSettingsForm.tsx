import { Search, X } from 'lucide-react'
import { Fragment, useId, useState } from 'react'
import { SettingRow, SettingsBlock, SettingsGroup, SettingsNote } from '@/app/settings'
import { m } from '@/paraglide/messages'
import { getLocale } from '@/paraglide/runtime'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/ui/input-group'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from '@/ui/item'
import { Switch } from '@/ui/switch'
import { MAX_ZONES, type WorldClockSettings } from './schema'
import { searchZones, zoneLabel } from '@/lib/zones'

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
                <InputGroup data-disabled={full || undefined}>
                  <InputGroupInput
                    aria-label={m.world_clock_settings_search_label()}
                    placeholder={m.world_clock_settings_search_placeholder()}
                    disabled={full}
                    aria-describedby={full ? `${id}-search-hint` : undefined}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  <InputGroupAddon>
                    <Search aria-hidden />
                  </InputGroupAddon>
                </InputGroup>
              </ItemContent>
            </Item>,
          ]}
        </SettingsGroup>
        {full ? (
          <SettingsNote>
            <span id={`${id}-search-hint`}>{m.world_clock_settings_full({ max: MAX_ZONES })}</span>
          </SettingsNote>
        ) : null}
        {results.length > 0 ? (
          <ItemGroup
            aria-label={m.world_clock_settings_results()}
            className="gap-0 overflow-hidden rounded-2xl border"
          >
            {results.map((zone, index) => (
              <Fragment key={`${zone.tz}|${zone.label}`}>
                {index > 0 ? <ItemSeparator className="my-0" /> : null}
                <li>
                  <Item
                    size="xs"
                    className="w-full rounded-none text-left hover:bg-muted"
                    render={(props) => (
                      <button type="button" {...props}>
                        {props.children}
                      </button>
                    )}
                    onClick={() => {
                      onChange({ ...value, zones: [...value.zones, zone.tz] })
                      setQuery('')
                    }}
                  >
                    <ItemContent>
                      <ItemTitle>{zone.label}</ItemTitle>
                    </ItemContent>
                    <ItemActions>
                      <ItemDescription className="text-xs">{zone.tz}</ItemDescription>
                    </ItemActions>
                  </Item>
                </li>
              </Fragment>
            ))}
          </ItemGroup>
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
