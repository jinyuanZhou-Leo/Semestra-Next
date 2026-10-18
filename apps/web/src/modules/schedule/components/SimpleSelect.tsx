import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'

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
