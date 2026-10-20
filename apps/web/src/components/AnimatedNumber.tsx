import { lazy, Suspense, useSyncExternalStore } from 'react'
import { useMotionPreference } from '@/app/theme'

// Calligraph and motion (~130 KB) load with the first figure that rolls, not with the app.
let loaded = false
const RollingNumber = lazy(() =>
  import('./RollingNumber').then((mod) => {
    loaded = true
    return mod
  }),
)

const REDUCE = '(prefers-reduced-motion: reduce)'

function subscribe(onChange: () => void) {
  const query = window.matchMedia(REDUCE)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/** Whether motion is off, by the app's setting or, under "system", by the OS. */
function useReducesMotion(): boolean {
  const preference = useMotionPreference()
  const system = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(REDUCE).matches,
    () => false,
  )
  return preference === 'always' || (preference === 'user' && system)
}

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
  const reduces = useReducesMotion()
  const text = format(value)
  const plain = <span className={className}>{text}</span>
  if (!Number.isFinite(value) || reduces) return plain
  // When the plain figure showed while the digits loaded, they take over without rolling in again.
  return (
    <Suspense fallback={plain}>
      <RollingNumber text={text} className={className} initial={loaded} />
    </Suspense>
  )
}
