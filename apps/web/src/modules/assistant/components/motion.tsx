import {
  AnimatePresence,
  MotionConfig,
  type Variants,
  motion,
  useIsPresent,
  useReducedMotion,
} from 'motion/react'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useMotionPreference } from '@/app/theme'
import { cn } from '@/lib/utils'

/** The frame shared by the input box and the panels that take its place. */
export const INPUT_FRAME = 'rounded-2xl border-border bg-background shadow-xs dark:bg-background'

const SPRING = { type: 'spring', duration: 0.35, bounce: 0 } as const

function useReduced() {
  const preference = useMotionPreference()
  const system = useReducedMotion()
  return preference === 'always' || (preference === 'user' && Boolean(system))
}

/**
 * Animates its own height to follow its content, so the area grows or shrinks smoothly when what is
 * inside changes. Content sits at the bottom: the box grows upward like the input it holds.
 * With `animateKey`, only a resize that follows a change of the key is animated (typing a long
 * message just grows the box); without it, every resize is.
 */
export function SmoothHeight({
  animateKey,
  className,
  children,
}: {
  animateKey?: string
  className?: string
  children: ReactNode
}) {
  const inner = useRef<HTMLDivElement>(null)
  const latest = useRef(animateKey)
  const measured = useRef(animateKey)
  const [size, setSize] = useState<{ height: number; animate: boolean } | null>(null)
  const reduced = useReduced()

  useLayoutEffect(() => {
    latest.current = animateKey
  })

  useEffect(() => {
    const el = inner.current
    if (!el) return
    let first = true
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const changed = latest.current === undefined || latest.current !== measured.current
      measured.current = latest.current
      const height = entry.borderBoxSize[0]?.blockSize ?? el.offsetHeight
      setSize({ height, animate: !first && changed })
      first = false
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const animate = Boolean(size?.animate) && !reduced
  return (
    <motion.div
      initial={false}
      animate={{ height: size ? size.height : 'auto' }}
      transition={animate ? SPRING : { duration: 0 }}
      // Menus inside are portals, so the clip only trims what is growing or leaving. The margin
      // and padding cancel out; they keep the shadow and focus ring inside it.
      className={cn('-m-1 flex flex-col justify-end overflow-hidden', className)}
    >
      <div ref={inner} className="relative p-1">
        {children}
      </div>
    </motion.div>
  )
}

// A light blur keeps the leaving and arriving text from reading as one muddle while they overlap.
const swap: Variants = {
  enter: (direction: number) => ({
    opacity: 0,
    x: direction * 16,
    y: direction ? 0 : 8,
    filter: 'blur(4px)',
  }),
  shown: { opacity: 1, x: 0, y: 0, filter: 'blur(0px)' },
  leave: (direction: number) => ({
    opacity: 0,
    x: direction * -16,
    y: direction ? 0 : 8,
    filter: 'blur(4px)',
    transition: { duration: 0.18, ease: 'easeOut' },
  }),
}

/** One item of `Swap`: while leaving it stops taking space, so the next one sets the height. */
function SwapItem({ children }: { children: ReactNode }) {
  const present = useIsPresent()
  return (
    <motion.div
      variants={swap}
      initial="enter"
      animate="shown"
      exit="leave"
      transition={SPRING}
      className={cn(!present && 'pointer-events-none absolute inset-x-1 bottom-1')}
    >
      {children}
    </motion.div>
  )
}

/**
 * Cross-fades between children keyed by `itemKey` inside a `SmoothHeight`: sideways in `direction`
 * (1 forward, -1 back), or up from below when `direction` is 0.
 */
export function Swap({
  itemKey,
  direction = 0,
  initial = false,
  children,
}: {
  itemKey: string | null
  direction?: number
  initial?: boolean
  children: ReactNode
}) {
  const motionPreference = useMotionPreference()
  return (
    <MotionConfig reducedMotion={motionPreference}>
      <AnimatePresence initial={initial} custom={direction}>
        {itemKey === null ? null : <SwapItem key={itemKey}>{children}</SwapItem>}
      </AnimatePresence>
    </MotionConfig>
  )
}

/** Kept mounted but hidden while `shown` is false; eases back in when shown again. */
export function Reveal({ shown, children }: { shown: boolean; children: ReactNode }) {
  const motionPreference = useMotionPreference()
  return (
    <MotionConfig reducedMotion={motionPreference}>
      <motion.div
        hidden={!shown}
        initial={false}
        animate={shown ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
        transition={SPRING}
      >
        {children}
      </motion.div>
    </MotionConfig>
  )
}
