import { useState, type ComponentProps } from 'react'
import { TextField } from '@/components/TextField'
import { suggestEmails } from '@/lib/email-domains'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'

type Props = Omit<ComponentProps<typeof TextField>, 'value' | 'onChange' | 'label'> & {
  value: string
  onValueChange: (value: string) => void
  label?: string
}

/** Email input that offers common domains after the "@". Tab accepts the first suggestion. */
export function EmailField({ value, onValueChange, label, onKeyDown, ...rest }: Props) {
  const [focused, setFocused] = useState(false)
  const suggestions = focused ? suggestEmails(value.trim()) : []

  return (
    <div>
      <TextField
        type="email"
        autoComplete="email"
        inputMode="email"
        label={label ?? m.auth_email_label()}
        placeholder={m.auth_email_placeholder()}
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
      {suggestions.length > 0 ? (
        <ul
          aria-label={m.auth_email_suggestions()}
          className="mt-2 flex flex-wrap gap-1.5"
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
    </div>
  )
}
