import { useId } from 'react'
import { SettingList, SettingRow } from '@/components/SettingRow'
import { m } from '@/paraglide/messages'
import { Input } from '@/ui/input'
import { Switch } from '@/ui/switch'
import type { PomodoroSettings } from './schema'

type Props = { value: PomodoroSettings; onChange: (value: PomodoroSettings) => void }

type NumberField = 'focus_min' | 'short_break_min' | 'long_break_min' | 'long_break_every'
type SwitchField = 'auto_start_next' | 'sound' | 'notify'

const LIMITS: Record<NumberField, [number, number]> = {
  focus_min: [1, 180],
  short_break_min: [1, 60],
  long_break_min: [1, 120],
  long_break_every: [2, 12],
}

/** Settings form of the pomodoro card: phase lengths, cycle, automation and alerts. */
export default function PomodoroSettingsForm({ value, onChange }: Props) {
  const id = useId()
  const numbers: [NumberField, string][] = [
    ['focus_min', m.pomodoro_settings_focus_min_label()],
    ['short_break_min', m.pomodoro_settings_short_break_min_label()],
    ['long_break_min', m.pomodoro_settings_long_break_min_label()],
    ['long_break_every', m.pomodoro_settings_long_break_every_label()],
  ]
  const switches: [SwitchField, string][] = [
    ['auto_start_next', m.pomodoro_settings_auto_start_next_label()],
    ['sound', m.pomodoro_settings_sound_label()],
    ['notify', m.pomodoro_settings_notify_label()],
  ]
  return (
    <SettingList>
      {numbers.map(([field, label]) => (
        <SettingRow
          key={field}
          label={label}
          labelId={`${id}-${field}`}
          htmlFor={`${id}-${field}-input`}
        >
          <Input
            id={`${id}-${field}-input`}
            type="number"
            min={LIMITS[field][0]}
            max={LIMITS[field][1]}
            value={value[field]}
            onChange={(event) => {
              const n = Math.trunc(Number(event.target.value))
              const [min, max] = LIMITS[field]
              if (n >= min && n <= max) onChange({ ...value, [field]: n })
            }}
            className="w-20"
          />
        </SettingRow>
      ))}
      {switches.map(([field, label]) => (
        <SettingRow key={field} label={label} labelId={`${id}-${field}`}>
          <Switch
            aria-labelledby={`${id}-${field}`}
            checked={value[field]}
            onCheckedChange={(checked) => onChange({ ...value, [field]: checked })}
          />
        </SettingRow>
      ))}
    </SettingList>
  )
}
