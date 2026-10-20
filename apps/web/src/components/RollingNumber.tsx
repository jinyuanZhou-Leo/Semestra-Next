import { Calligraph } from 'calligraph'
import { MotionConfig, useReducedMotion } from 'motion/react'
import { useMotionPreference } from '@/app/theme'

/** The rolling digits of `AnimatedNumber`, loaded on first use with calligraph and motion. */
export default function RollingNumber({ text, className }: { text: string; className?: string }) {
  const reducedMotion = useMotionPreference()
  const reduced = useReducedMotion()
  if (reduced) return <span className={className}>{text}</span>
  // Calligraph hides its digits from assistive technology, so the value is also in plain text.
  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        <MotionConfig reducedMotion={reducedMotion}>
          <Calligraph variant="number" animation="smooth" initial autoSize={false}>
            {text}
          </Calligraph>
        </MotionConfig>
      </span>
    </span>
  )
}
