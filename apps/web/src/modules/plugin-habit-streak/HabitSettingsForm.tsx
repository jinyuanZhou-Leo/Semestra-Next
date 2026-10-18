import { useId } from 'react'
import { SegmentedControl } from '@/components/SegmentedControl'
import { SettingList, SettingRow } from '@/components/SettingRow'
import { TextField } from '@/components/TextField'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Switch } from '@/ui/switch'
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
      <TextField
        label={m.habit_settings_name_label()}
        placeholder={m.habit_settings_name_placeholder()}
        maxLength={60}
        value={value.name}
        onChange={(event) => set({ name: event.target.value })}
      />
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="mb-2 text-sm font-medium">{m.habit_settings_icon_label()}</legend>
        <div className="flex flex-wrap gap-1.5">
          {HABIT_ICONS.map((name) => {
            return (
              <button
                key={name}
                type="button"
                aria-pressed={value.icon === name}
                aria-label={name}
                onClick={() => set({ icon: name })}
                className={cn(
                  'flex size-9 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-muted',
                  value.icon === name && 'border-primary bg-primary/10 text-primary',
                )}
              >
                <HabitIcon name={name} aria-hidden className="size-4" />
              </button>
            )
          })}
        </div>
      </fieldset>
      <SettingList>
        <SettingRow label={m.habit_settings_goal_label()} labelId={`${id}-goal`}>
          <SegmentedControl
            aria-labelledby={`${id}-goal`}
            value={value.goal}
            onValueChange={(goal) => set({ goal })}
            options={[
              { value: 'daily', label: m.habit_settings_goal_option_daily() },
              { value: 'weekly', label: m.habit_settings_goal_option_weekly() },
            ]}
          />
        </SettingRow>
        {value.goal === 'weekly' ? (
          <SettingRow
            label={m.habit_settings_weekly_target_label()}
            labelId={`${id}-target`}
            htmlFor={`${id}-target-input`}
          >
            <input
              id={`${id}-target-input`}
              type="number"
              min={1}
              max={7}
              value={value.weekly_target}
              onChange={(event) => {
                const n = Math.trunc(Number(event.target.value))
                if (n >= 1 && n <= 7) set({ weekly_target: n })
              }}
              className="h-9 w-20 rounded-4xl border border-input bg-transparent px-3 text-sm"
            />
          </SettingRow>
        ) : null}
        <SettingRow
          label={m.habit_settings_show_toast_label()}
          labelId={`${id}-toast`}
          description={m.habit_settings_show_toast_description()}
        >
          <Switch
            aria-labelledby={`${id}-toast`}
            checked={value.show_toast}
            onCheckedChange={(show_toast) => set({ show_toast })}
          />
        </SettingRow>
      </SettingList>
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="mb-2 text-sm font-medium">{m.habit_settings_color_label()}</legend>
        <div className="flex flex-wrap gap-2">
          {COLOR_TOKENS.map((token) => (
            <button
              key={token}
              type="button"
              aria-pressed={value.color === token}
              aria-label={COLOR_NAMES[token]()}
              title={COLOR_NAMES[token]()}
              onClick={() => set({ color: token })}
              className={cn(
                'size-7 rounded-full ring-offset-2 ring-offset-background',
                value.color === token && 'ring-2 ring-foreground/60',
              )}
              style={{ backgroundColor: colorVar(token) }}
            />
          ))}
        </div>
      </fieldset>
    </div>
  )
}
