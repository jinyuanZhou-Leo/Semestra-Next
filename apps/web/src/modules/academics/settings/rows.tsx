import { type ReactNode, useId, useState } from 'react'
import { SettingRow } from '@/components/SettingRow'
import { Input } from '@/ui/input'
import { Textarea } from '@/ui/textarea'

/** A text setting saved as typed; `required` keeps an empty value from being sent. */
export function TextRow({
  label,
  description,
  value,
  onChange,
  required,
  multiline,
  type = 'text',
  placeholder,
  invalid,
}: {
  label: string
  description?: string
  value: string
  onChange: (value: string) => void
  required?: boolean
  multiline?: boolean
  type?: 'text' | 'url' | 'date'
  placeholder?: string
  /** Shown under the field, e.g. the server's validation message. */
  invalid?: string | null
}) {
  const id = useId()
  const [text, setText] = useState(value)
  const error = invalid ?? (required && text.trim() === '' ? '' : null)
  const props = {
    id: `${id}-input`,
    'aria-labelledby': `${id}-label`,
    'aria-invalid': error !== null ? true : undefined,
    placeholder,
    value: text,
    onChange: (event: { target: { value: string } }) => {
      setText(event.target.value)
      if (!(required && event.target.value.trim() === '')) onChange(event.target.value)
    },
  }
  return (
    <SettingRow
      label={label}
      labelId={`${id}-label`}
      htmlFor={`${id}-input`}
      description={description}
    >
      <div className="flex flex-col items-end gap-1">
        {multiline ? (
          <Textarea {...props} className="w-80" rows={3} />
        ) : (
          <Input {...props} type={type} className={type === 'date' ? 'w-44' : 'w-64'} />
        )}
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </SettingRow>
  )
}

/** A number setting; values outside `min`..`max` are not sent. Empty means null when `nullable`. */
export function NumberRow({
  label,
  description,
  value,
  onChange,
  min = 0,
  max = 1000,
  nullable,
}: {
  label: string
  description?: string
  value: number | null
  onChange: (value: number | null) => void
  min?: number
  max?: number
  nullable?: boolean
}) {
  const id = useId()
  const [text, setText] = useState(value == null ? '' : String(value))
  const valid = (t: string) =>
    t.trim() === '' ? Boolean(nullable) : Number(t) >= min && Number(t) <= max
  return (
    <SettingRow
      label={label}
      labelId={`${id}-label`}
      htmlFor={`${id}-input`}
      description={description}
    >
      <Input
        id={`${id}-input`}
        type="number"
        inputMode="decimal"
        step="any"
        min={min}
        max={max}
        className="w-28"
        aria-labelledby={`${id}-label`}
        aria-invalid={valid(text) ? undefined : true}
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          if (valid(event.target.value)) {
            onChange(event.target.value.trim() === '' ? null : Number(event.target.value))
          }
        }}
      />
    </SettingRow>
  )
}

/** A setting row whose control is given (switch, color picker, …). */
export function ControlRow({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: (labelId: string) => ReactNode
}) {
  const id = useId()
  return (
    <SettingRow label={label} labelId={`${id}-label`} description={description}>
      {children(`${id}-label`)}
    </SettingRow>
  )
}
