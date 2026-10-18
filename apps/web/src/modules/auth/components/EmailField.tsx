import { useId, useState, type ComponentProps } from 'react'
import { suggestEmails } from '@/lib/email-domains'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Field, FieldError, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'

type Props = Omit<ComponentProps<typeof Input>, 'id' | 'value' | 'onChange'> & {
  value: string
  onValueChange: (value: string) => void
  label?: string
  error?: string | null
}

/** Email input that offers common domains after the "@". Tab accepts the first suggestion. */
export function EmailField({
  value,
  onValueChange,
  label,
  error,
  className,
  onKeyDown,
  ...rest
}: Props) {
  const id = useId()
  const [focused, setFocused] = useState(false)
  const suggestions = focused ? suggestEmails(value.trim()) : []

  return (
    <Field data-invalid={error ? true : undefined} className={className}>
      <FieldLabel htmlFor={id}>{label ?? m.auth_email_label()}</FieldLabel>
      <Input
        id={id}
        type="email"
        autoComplete="email"
        inputMode="email"
        placeholder={m.auth_email_placeholder()}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          const first = suggestions[0]
          if (e.key === 'Tab' && !e.shiftKey && first) {
            e.preventDefault()
            onValueChange(first)
          }
          onKeyDown?.(e)
        }}
        {...rest}
      />
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
      {suggestions.length > 0 ? (
        <ul
          aria-label={m.auth_email_suggestions()}
          className="flex flex-wrap gap-1.5"
          data-testid="email-suggestions"
        >
          {suggestions.map((s) => (
            <li key={s}>
              <Button
                type="button"
                variant="outline"
                size="xs"
                // keep focus on the input so blur doesn't remove the list before the click lands
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onValueChange(s)}
              >
                {s}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </Field>
  )
}
