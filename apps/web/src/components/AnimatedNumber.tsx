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
  return (
    <Calligraph variant="number" animation="smooth" initial autoSize={false} className={className}>
      {text}
    </Calligraph>
  )
}
