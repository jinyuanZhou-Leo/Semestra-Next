import { type KeyboardEvent, useState } from 'react'
import { cn } from '@/lib/utils'
import { Input } from '@/ui/input'

/**
 * A table cell you type into. Enter or leaving the cell commits; Escape puts the stored value
 * back. `onCommit` returns false when the text is not acceptable. Give it `key={value}` so a
 * saved value from the server replaces what was typed.
 */
export function InlineInput({
  value,
  onCommit,
  label,
  placeholder,
  className,
  tone,
}: {
  value: string
  onCommit: (text: string) => boolean | void
  label: string
  placeholder?: string
  className?: string
  /** `assumed` marks a what-if value that is not saved as a grade. */
  tone?: 'assumed'
}) {
  const [text, setText] = useState(value)
  const [invalid, setInvalid] = useState(false)
  const commit = () => {
    if (text.trim() === value.trim()) {
      setInvalid(false)
      return
    }
    setInvalid(onCommit(text) === false)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur()
    if (event.key === 'Escape') {
      setText(value)
      setInvalid(false)
    }
  }
  return (
    <Input
      aria-label={label}
      aria-invalid={invalid ? true : undefined}
      placeholder={placeholder}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      className={cn(
        'h-8 w-24 border-transparent bg-transparent text-right shadow-none tabular-nums hover:border-input',
        tone === 'assumed' && 'bg-primary/10 hover:border-primary/40',
        className,
      )}
    />
  )
}
