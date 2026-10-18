import { useId, type ComponentProps, type ReactNode } from 'react'
import { Input } from '@/ui/input'
import { Label } from '@/ui/label'

type Props = Omit<ComponentProps<typeof Input>, 'id'> & {
  label: string
  error?: string | null
  hint?: ReactNode
}

/** Label + input + hint/error wired together for screen readers. */
export function TextField({ label, error, hint, className, ...input }: Props) {
  const id = useId()
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={className}>
      <Label htmlFor={id} className="mb-2">
        {label}
      </Label>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...input}
      />
      {hint && !error ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
