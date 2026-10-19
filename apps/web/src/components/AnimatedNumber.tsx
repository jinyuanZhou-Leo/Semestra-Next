import { Calligraph } from 'calligraph'
import { useReducedMotion } from 'motion/react'

/**
 * A headline figure whose digits roll when it first appears and whenever `value` changes. For
 * big numbers on overview cards only; tables and lists show plain text. `format` produces the
 * displayed text (locale aware), so the roll follows what the user reads.
 */
export function AnimatedNumber({
  value,
  format,
  className,
}: {
  value: number
  format: (value: number) => string
  className?: string
}) {
  const text = format(value)
  const reduced = useReducedMotion()
  if (reduced || !Number.isFinite(value)) return <span className={className}>{text}</span>
  // Calligraph hides its digits from assistive technology, so the value is also in plain text.
  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        <Calligraph variant="number" animation="smooth" initial autoSize={false}>
          {text}
        </Calligraph>
      </span>
    </span>
  )
}
