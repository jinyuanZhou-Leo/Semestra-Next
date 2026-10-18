import { type ReactElement, type ReactNode, cloneElement, useId } from 'react'
import { cn } from '@/lib/utils'
import { Label } from '@/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'

/** A label above any control; the control receives the generated `id`. */
export function Field({
  label,
  error,
  className,
  children,
}: {
  label: string
  error?: string | null
  className?: string
  children: ReactElement<{ id?: string; 'aria-invalid'?: boolean }>
}) {
  const id = useId()
  return (
    <div className={cn('min-w-0', className)}>
      <Label htmlFor={id} className="mb-2">
        {label}
      </Label>
      {cloneElement(children, { id, 'aria-invalid': error ? true : undefined })}
      {error ? (
        <p role="alert" className="mt-1.5 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export type Option = { value: string; label: ReactNode }

/** A Select over plain string options. */
export function SimpleSelect({
  id,
  value,
  onChange,
  options,
  className,
  'aria-label': ariaLabel,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  options: readonly Option[]
  className?: string
  'aria-label'?: string
}) {
  return (
    <Select
      value={value}
      items={options.map((o) => ({ value: o.value, label: o.label }))}
      onValueChange={(next) => next != null && onChange(String(next))}
    >
      <SelectTrigger id={id} aria-label={ariaLabel} className={cn('w-full', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
