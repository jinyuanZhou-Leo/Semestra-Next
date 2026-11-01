import { useId, useState } from 'react'
import { m } from '@/paraglide/messages'
import { SettingRow, SettingsGroup, SettingsNote } from '@/app/settings'
import { FieldError } from '@/ui/field'
import { Input } from '@/ui/input'
import { Switch } from '@/ui/switch'
import { applyEdit, problemOf } from './counter'
import { COUNTER_LABEL_MAX, type CounterSettings } from './schema'

type Props = { value: CounterSettings; onChange: (value: CounterSettings) => void }

type NumberField = 'min' | 'max' | 'step' | 'initial'

/** Settings form of the counter card: range checks, and a note when the count had to move. */
export default function CounterSettingsForm({ value, onChange }: Props) {
  const [clampedTo, setClampedTo] = useState<number | null>(null)
  const id = useId()
  const problem = problemOf(value)

  const edit = (patch: Partial<CounterSettings>) => {
    const { settings, clampedTo: moved } = applyEdit(value, patch)
    setClampedTo(moved)
    onChange(settings)
  }
  const number = (field: NumberField) => (event: { target: { value: string } }) => {
    const parsed = Number(event.target.value)
    if (event.target.value !== '' && Number.isFinite(parsed)) edit({ [field]: Math.trunc(parsed) })
  }
  const numbers: [NumberField, string, string | null][] = [
    [
      'min',
      m.counter_settings_min_label(),
      problem === 'range' ? m.counter_settings_error_range() : null,
    ],
    ['max', m.counter_settings_max_label(), null],
    [
      'step',
      m.counter_settings_step_label(),
      problem === 'step' ? m.counter_settings_error_step() : null,
    ],
    [
      'initial',
      m.counter_settings_initial_label(),
      problem === 'initial' ? m.counter_settings_error_initial() : null,
    ],
  ]

  return (
    <div className="space-y-3">
      <SettingsGroup>
        {[
          <SettingRow
            key="label"
            label={m.counter_settings_label_label()}
            htmlFor={`${id}-label-input`}
          >
            <Input
              id={`${id}-label-input`}
              className="w-48"
              placeholder={m.counter_settings_label_placeholder()}
              maxLength={COUNTER_LABEL_MAX}
              value={value.label}
              onChange={(event) => edit({ label: event.target.value })}
            />
          </SettingRow>,
          ...numbers.map(([field, label, error]) => (
            <SettingRow key={field} label={label} htmlFor={`${id}-${field}`}>
              <div className="flex flex-col items-end gap-1">
                <Input
                  id={`${id}-${field}`}
                  type="number"
                  className="w-28"
                  min={field === 'step' ? 1 : undefined}
                  value={value[field]}
                  onChange={number(field)}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `${id}-${field}-error` : undefined}
                />
                {error ? (
                  <FieldError id={`${id}-${field}-error`} className="text-xs">
                    {error}
                  </FieldError>
                ) : null}
              </div>
            </SettingRow>
          )),
          <SettingRow key="ring" label={m.counter_settings_show_ring_label()}>
            {(labelId) => (
              <Switch
                aria-labelledby={labelId}
                checked={value.show_ring}
                onCheckedChange={(checked) => edit({ show_ring: checked })}
              />
            )}
          </SettingRow>,
        ]}
      </SettingsGroup>
      {clampedTo !== null ? (
        <SettingsNote>
          <output>{m.counter_settings_clamped({ value: clampedTo })}</output>
        </SettingsNote>
      ) : null}
    </div>
  )
}
