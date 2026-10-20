import { lazy, Suspense } from 'react'

// Calligraph and motion (~130 KB) load with the first figure that rolls, not with the app.
const RollingNumber = lazy(() => import('./RollingNumber'))

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
  const plain = <span className={className}>{text}</span>
  if (!Number.isFinite(value)) return plain
  return (
    <Suspense fallback={plain}>
      <RollingNumber text={text} className={className} />
    </Suspense>
  )
}
