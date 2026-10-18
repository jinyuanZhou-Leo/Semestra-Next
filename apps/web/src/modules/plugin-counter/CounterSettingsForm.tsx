import { useId, useState } from 'react'
import { m } from '@/paraglide/messages'
import { Field, FieldError, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from '@/ui/item'
import { Label } from '@/ui/label'
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
    <div className="space-y-4">
      <Field>
        <FieldLabel htmlFor={`${id}-label`}>{m.counter_settings_label_label()}</FieldLabel>
        <Input
          id={`${id}-label`}
          placeholder={m.counter_settings_label_placeholder()}
          maxLength={COUNTER_LABEL_MAX}
          value={value.label}
          onChange={(event) => edit({ label: event.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        {numbers.map(([field, label, error]) => (
          <Field key={field} data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor={`${id}-${field}`}>{label}</FieldLabel>
            <Input
              id={`${id}-${field}`}
              type="number"
              min={field === 'step' ? 1 : undefined}
              value={value[field]}
              onChange={number(field)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-${field}-error` : undefined}
            />
            {error ? <FieldError id={`${id}-${field}-error`}>{error}</FieldError> : null}
          </Field>
        ))}
      </div>
      <ItemGroup className="rounded-2xl border">
        <Item render={<li />}>
          <ItemContent>
            <ItemTitle>
              <Label id={`${id}-ring`}>{m.counter_settings_show_ring_label()}</Label>
            </ItemTitle>
          </ItemContent>
          <ItemActions>
            <Switch
              aria-labelledby={`${id}-ring`}
              checked={value.show_ring}
              onCheckedChange={(checked) => edit({ show_ring: checked })}
            />
          </ItemActions>
        </Item>
      </ItemGroup>
      {clampedTo !== null ? (
        <output className="block text-sm text-muted-foreground">
          {m.counter_settings_clamped({ value: clampedTo })}
        </output>
      ) : null}
    </div>
  )
}
