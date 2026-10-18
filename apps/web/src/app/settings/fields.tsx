import { useState } from 'react'
import { SegmentedControl } from '@/components/SegmentedControl'
import { m } from '@/paraglide/messages'
import { Input } from '@/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Switch } from '@/ui/switch'
import type { FieldDescriptor } from './schema'
import { optionLabel } from './texts'

export type ControlProps = {
  namespace: string
  field: FieldDescriptor
  id: string
  labelId: string
  value: unknown
  onChange: (value: unknown) => void
}

function numberProblem(field: FieldDescriptor, text: string): string | null {
  if (text.trim() === '') return field.nullable ? null : m.settings_number_invalid()
  const n = Number(text)
  if (!Number.isFinite(n) || (field.integer && !Number.isInteger(n))) {
    return m.settings_number_invalid()
  }
  const { min, max } = field
  if (min !== undefined && max !== undefined && (n < min || n > max)) {
    return m.settings_number_range({ min, max })
  }
  if (min !== undefined && n < min) return m.settings_number_min({ min })
  if (max !== undefined && n > max) return m.settings_number_max({ max })
  return null
}

function NumberControl({ field, id, labelId, value, onChange }: ControlProps) {
  const [text, setText] = useState(value == null ? '' : String(value))
  // Follow outside changes (a reset, a refetch) but never overwrite what is being typed.
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    const typed = text.trim() === '' ? null : Number(text)
    if (typed !== (value ?? null)) setText(value == null ? '' : String(value))
  }
  const problem = numberProblem(field, text)
  return (
    <div className="flex flex-col items-end gap-1">
      <Input
        id={id}
        type="number"
        inputMode={field.integer ? 'numeric' : 'decimal'}
        aria-labelledby={labelId}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? `${id}-error` : undefined}
        min={field.min}
        max={field.max}
        step={field.integer ? 1 : 'any'}
        className="w-28"
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          if (numberProblem(field, event.target.value) === null) {
            onChange(event.target.value.trim() === '' ? null : Number(event.target.value))
          }
        }}
      />
      {problem ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      ) : null}
    </div>
  )
}

export function FieldControlView(props: ControlProps) {
  const { namespace, field, id, labelId, value, onChange } = props
  switch (field.control) {
    case 'switch':
      return (
        <Switch
          id={id}
          aria-labelledby={labelId}
          checked={value === true}
          onCheckedChange={(checked) => onChange(checked)}
        />
      )
    case 'segmented':
      return (
        <SegmentedControl
          aria-labelledby={labelId}
          value={String(value)}
          onValueChange={(next) => onChange(field.options.find((o) => String(o) === next))}
          options={field.options.map((o) => ({
            value: String(o),
            label: optionLabel(namespace, field.key, o),
          }))}
        />
      )
    case 'select':
      return (
        <Select
          value={String(value)}
          items={field.options.map((o) => ({
            value: String(o),
            label: optionLabel(namespace, field.key, o),
          }))}
          onValueChange={(next) => onChange(field.options.find((o) => String(o) === next))}
        >
          <SelectTrigger id={id} aria-labelledby={labelId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((o) => (
              <SelectItem key={String(o)} value={String(o)}>
                {optionLabel(namespace, field.key, o)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    case 'number':
      return <NumberControl {...props} />
    case 'time':
      return (
        <Input
          id={id}
          type="time"
          aria-labelledby={labelId}
          className="w-32"
          value={typeof value === 'string' ? value.slice(0, 5) : ''}
          onChange={(event) => {
            if (event.target.value) onChange(event.target.value)
          }}
        />
      )
    case 'text':
      return (
        <Input
          id={id}
          aria-labelledby={labelId}
          className="w-64"
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        />
      )
  }
}
