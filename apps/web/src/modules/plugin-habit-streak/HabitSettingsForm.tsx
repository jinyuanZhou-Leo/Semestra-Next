import { Clock2 } from 'lucide-react'
import { useId } from 'react'
import { ChoiceControl, SettingRow, SettingsGroup } from '@/app/settings'
import { COLLAPSE } from '@/lib/collapse'

import { TIME_INPUT } from '@/lib/time-input'
import { useDeviceState } from '@/modules/notifications/push'
import { m } from '@/paraglide/messages'
import { Collapsible, CollapsibleContent } from '@/ui/collapsible'
import { Input } from '@/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/ui/input-group'
import { ItemSeparator } from '@/ui/item'
import { ColorSwatch } from '@/components/ColorSwatch'
import { RadioGroup } from '@/ui/radio-group'
import { Switch } from '@/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'
import { COLOR_TOKENS, colorVar } from '../plugin-kit/colors'
import { HabitIcon } from './icons'
import { HABIT_ICONS, type HabitSettings } from './schema'

type Props = { value: HabitSettings; onChange: (value: HabitSettings) => void }

const COLOR_NAMES: Record<(typeof COLOR_TOKENS)[number], () => string> = {
  primary: m.habit_color_primary,
  success: m.habit_color_success,
  'subject-1': m.habit_color_subject_1,
  'subject-2': m.habit_color_subject_2,
  'subject-7': m.habit_color_subject_7,
  'subject-9': m.habit_color_subject_9,
  'subject-10': m.habit_color_subject_10,
  'subject-11': m.habit_color_subject_11,
}

/** Settings form of the habit card (name, icon, color, goal, daily reminder). */
export default function HabitSettingsForm({ value, onChange }: Props) {
  const id = useId()
  const device = useDeviceState()
  // The reminder is a notification: say so when this device would not show it.
  const deviceOff = value.remind && device !== 'on' && device !== 'checking'
  const set = (patch: Partial<HabitSettings>) => onChange({ ...value, ...patch })
  return (
    <div className="space-y-4">
      <SettingsGroup>
        {[
          <SettingRow key="name" label={m.habit_settings_name_label()} htmlFor={`${id}-name`}>
            <Input
              id={`${id}-name`}
              className="w-48"
              placeholder={m.habit_settings_name_placeholder()}
              maxLength={60}
              value={value.name}
              onChange={(event) => set({ name: event.target.value })}
            />
          </SettingRow>,
          <SettingRow key="icon" label={m.habit_settings_icon_label()}>
            {(labelId) => (
              <ToggleGroup
                aria-labelledby={labelId}
                variant="outline"
                spacing={1.5}
                value={[value.icon]}
                onValueChange={(next) => {
                  if (next[0]) set({ icon: next[0] as HabitSettings['icon'] })
                }}
                className="flex-wrap"
              >
                {HABIT_ICONS.map((name) => (
                  <ToggleGroupItem
                    key={name}
                    value={name}
                    aria-label={name}
                    className="size-9 rounded-xl px-0 text-muted-foreground aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary"
                  >
                    <HabitIcon name={name} aria-hidden className="size-4" />
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            )}
          </SettingRow>,
          <SettingRow key="color" label={m.habit_settings_color_label()}>
            {(labelId) => (
              <RadioGroup
                aria-labelledby={labelId}
                value={value.color}
                onValueChange={(color) => set({ color: color as HabitSettings['color'] })}
                className="flex flex-wrap gap-2"
              >
                {COLOR_TOKENS.map((token) => (
                  <ColorSwatch
                    key={token}
                    value={token}
                    aria-label={COLOR_NAMES[token]()}
                    className="size-7"
                    color={colorVar(token)}
                    checkColor="var(--background)"
                  />
                ))}
              </RadioGroup>
            )}
          </SettingRow>,
        ]}
      </SettingsGroup>
      <SettingsGroup>
        {[
          <Collapsible key="goal" open={value.goal === 'weekly'}>
            <SettingRow label={m.habit_settings_goal_label()}>
              {(labelId) => (
                <ChoiceControl
                  labelId={labelId}
                  options={[
                    { value: 'daily', label: m.habit_settings_goal_option_daily() },
                    { value: 'weekly', label: m.habit_settings_goal_option_weekly() },
                  ]}
                  value={value.goal}
                  onChange={(goal) => set({ goal })}
                />
              )}
            </SettingRow>
            <CollapsibleContent className={COLLAPSE}>
              <ItemSeparator className="my-0" />
              <SettingRow
                label={m.habit_settings_weekly_target_label()}
                htmlFor={`${id}-target-input`}
              >
                <Input
                  id={`${id}-target-input`}
                  type="number"
                  min={1}
                  max={7}
                  value={value.weekly_target}
                  onChange={(event) => {
                    const n = Math.trunc(Number(event.target.value))
                    if (n >= 1 && n <= 7) set({ weekly_target: n })
                  }}
                  className="w-28"
                />
              </SettingRow>
            </CollapsibleContent>
          </Collapsible>,
          <SettingRow
            key="toast"
            label={m.habit_settings_show_toast_label()}
            description={m.habit_settings_show_toast_description()}
          >
            {(labelId) => (
              <Switch
                aria-labelledby={labelId}
                checked={value.show_toast}
                onCheckedChange={(show_toast) => set({ show_toast })}
              />
            )}
          </SettingRow>,
        ]}
      </SettingsGroup>
      <SettingsGroup>
        {[
          <Collapsible key="remind" open={value.remind}>
            <SettingRow
              label={m.habit_settings_remind_label()}
              description={deviceOff ? m.habit_settings_remind_device_off() : undefined}
            >
              {(labelId) => (
                <Switch
                  aria-labelledby={labelId}
                  checked={value.remind}
                  onCheckedChange={(remind) => set({ remind })}
                />
              )}
            </SettingRow>
            <CollapsibleContent className={COLLAPSE}>
              <ItemSeparator className="my-0" />
              <SettingRow label={m.habit_settings_remind_at_label()} htmlFor={`${id}-remind-at`}>
                <InputGroup className="w-32">
                  <InputGroupInput
                    id={`${id}-remind-at`}
                    type="time"
                    className={TIME_INPUT}
                    value={value.remind_at}
                    onChange={(event) => {
                      if (event.target.value) set({ remind_at: event.target.value.slice(0, 5) })
                    }}
                  />
                  <InputGroupAddon>
                    <Clock2 aria-hidden />
                  </InputGroupAddon>
                </InputGroup>
              </SettingRow>
            </CollapsibleContent>
          </Collapsible>,
        ]}
      </SettingsGroup>
    </div>
  )
}
