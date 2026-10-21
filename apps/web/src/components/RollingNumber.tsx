import { Calligraph } from 'calligraph'
import { MotionConfig } from 'motion/react'
import { useMotionPreference } from '@/app/theme'

/** The rolling digits of `AnimatedNumber`, loaded on first use with calligraph and motion. */
export default function RollingNumber({
  text,
  className,
  initial,
}: {
  text: string
  className?: string
  /** Roll in on mount (not when taking over from the plain figure shown while loading). */
  initial: boolean
}) {
  const reducedMotion = useMotionPreference()
  // Calligraph hides its digits from assistive technology, so the value is also in plain text.
  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        <MotionConfig reducedMotion={reducedMotion}>
          <Calligraph variant="number" animation="smooth" initial={initial} autoSize={false}>
            {text}
          </Calligraph>
        </MotionConfig>
      </span>
    </span>
  )
}
