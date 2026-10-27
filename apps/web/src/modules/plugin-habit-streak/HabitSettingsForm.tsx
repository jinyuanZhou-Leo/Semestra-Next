import { useId } from 'react'
import { ChoiceControl, SettingRow, SettingsGroup } from '@/app/settings'
import { m } from '@/paraglide/messages'
import { Field, FieldLabel, FieldLegend, FieldSet } from '@/ui/field'
import { Input } from '@/ui/input'
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

/** Settings form of both habit cards (name, icon, goal, color). */
export default function HabitSettingsForm({ value, onChange }: Props) {
  const id = useId()
  const set = (patch: Partial<HabitSettings>) => onChange({ ...value, ...patch })
  return (
    <div className="space-y-4">
      <Field>
        <FieldLabel htmlFor={`${id}-name`}>{m.habit_settings_name_label()}</FieldLabel>
        <Input
          id={`${id}-name`}
          placeholder={m.habit_settings_name_placeholder()}
          maxLength={60}
          value={value.name}
          onChange={(event) => set({ name: event.target.value })}
        />
      </Field>
      <FieldSet className="gap-2">
        <FieldLegend variant="label" id={`${id}-icon`}>
          {m.habit_settings_icon_label()}
        </FieldLegend>
        <ToggleGroup
          aria-labelledby={`${id}-icon`}
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
      </FieldSet>
      <SettingsGroup>
        {[
          <SettingRow key="goal" label={m.habit_settings_goal_label()}>
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
          </SettingRow>,
          value.goal === 'weekly' ? (
            <SettingRow
              key="target"
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
                className="w-20"
              />
            </SettingRow>
          ) : null,
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
      <FieldSet className="gap-2">
        <FieldLegend variant="label" id={`${id}-color`}>
          {m.habit_settings_color_label()}
        </FieldLegend>
        <RadioGroup
          aria-labelledby={`${id}-color`}
          value={value.color}
          onValueChange={(color) => set({ color: color as HabitSettings['color'] })}
          className="flex flex-wrap gap-2"
        >
          {COLOR_TOKENS.map((token) => (
            <ColorSwatch
              key={token}
              value={token}
              aria-label={COLOR_NAMES[token]()}
              title={COLOR_NAMES[token]()}
              className="size-7"
              color={colorVar(token)}
              checkColor="var(--background)"
            />
          ))}
        </RadioGroup>
      </FieldSet>
    </div>
  )
}
