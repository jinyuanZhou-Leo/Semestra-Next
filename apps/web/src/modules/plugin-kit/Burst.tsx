import { motion, useReducedMotion } from 'motion/react'
import { useEffect } from 'react'

const PARTICLES = 14

function reducedMotion(prefers: boolean | null) {
  return prefers || document.documentElement.getAttribute('data-reduce-motion') === 'on'
}

/**
 * A short burst of dots from the middle of the parent (habit milestones). Does nothing when the
 * user asked for reduced motion. The parent must be `relative`.
 */
export function Burst({ color, onDone }: { color: string; onDone?: () => void }) {
  const prefers = useReducedMotion()
  const skip = reducedMotion(prefers)
  useEffect(() => {
    if (!skip) return
    onDone?.()
  }, [skip, onDone])
  if (skip) return null
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
    >
      {Array.from({ length: PARTICLES }, (_, i) => {
        const angle = (i / PARTICLES) * Math.PI * 2
        const distance = 44 + (i % 3) * 14
        return (
          <motion.span
            key={i}
            className="absolute size-1.5 rounded-full"
            style={{ backgroundColor: color }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{
              x: Math.cos(angle) * distance,
              y: Math.sin(angle) * distance,
              opacity: 0,
              scale: 0.4,
            }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            onAnimationComplete={i === 0 ? onDone : undefined}
          />
        )
      })}
    </span>
  )
}
