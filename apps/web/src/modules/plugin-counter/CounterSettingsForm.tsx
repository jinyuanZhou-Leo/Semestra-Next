import { useId, useState } from 'react'
import { SettingList, SettingRow } from '@/components/SettingRow'
import { TextField } from '@/components/TextField'
import { m } from '@/paraglide/messages'
import { Switch } from '@/ui/switch'
import { applyEdit, problemOf } from './counter'
import { COUNTER_LABEL_MAX, type CounterSettings } from './schema'

type Props = { value: CounterSettings; onChange: (value: CounterSettings) => void }

/** Settings form of the counter card: range checks, and a note when the count had to move. */
export default function CounterSettingsForm({ value, onChange }: Props) {
  const [clampedTo, setClampedTo] = useState<number | null>(null)
  const switchId = useId()
  const problem = problemOf(value)

  const edit = (patch: Partial<CounterSettings>) => {
    const { settings, clampedTo: moved } = applyEdit(value, patch)
    setClampedTo(moved)
    onChange(settings)
  }
  const number =
    (field: 'min' | 'max' | 'step' | 'initial') => (event: { target: { value: string } }) => {
      const parsed = Number(event.target.value)
      if (event.target.value !== '' && Number.isFinite(parsed))
        edit({ [field]: Math.trunc(parsed) })
    }

  return (
    <div className="space-y-4">
      <TextField
        label={m.counter_settings_label_label()}
        placeholder={m.counter_settings_label_placeholder()}
        maxLength={COUNTER_LABEL_MAX}
        value={value.label}
        onChange={(event) => edit({ label: event.target.value })}
      />
      <div className="grid grid-cols-2 gap-4">
        <TextField
          type="number"
          label={m.counter_settings_min_label()}
          value={value.min}
          onChange={number('min')}
          error={problem === 'range' ? m.counter_settings_error_range() : null}
        />
        <TextField
          type="number"
          label={m.counter_settings_max_label()}
          value={value.max}
          onChange={number('max')}
        />
        <TextField
          type="number"
          min={1}
          label={m.counter_settings_step_label()}
          value={value.step}
          onChange={number('step')}
          error={problem === 'step' ? m.counter_settings_error_step() : null}
        />
        <TextField
          type="number"
          label={m.counter_settings_initial_label()}
          value={value.initial}
          onChange={number('initial')}
          error={problem === 'initial' ? m.counter_settings_error_initial() : null}
        />
      </div>
      <SettingList>
        <SettingRow label={m.counter_settings_show_ring_label()} labelId={`${switchId}-label`}>
          <Switch
            aria-labelledby={`${switchId}-label`}
            checked={value.show_ring}
            onCheckedChange={(checked) => edit({ show_ring: checked })}
          />
        </SettingRow>
      </SettingList>
      {clampedTo !== null ? (
        <output className="block text-sm text-muted-foreground">
          {m.counter_settings_clamped({ value: clampedTo })}
        </output>
      ) : null}
    </div>
  )
}
