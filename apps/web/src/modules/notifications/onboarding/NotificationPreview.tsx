import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import type { Message } from '@/app/extensions'
import { useMotionPreference, useReducedMotion } from '@/app/theme'
import { m } from '@/paraglide/messages'

const SAMPLES: readonly { title: Message; body: Message }[] = [
  { title: m.notifications_sample_class_title, body: m.notifications_sample_class_body },
  { title: m.notifications_sample_task_title, body: m.notifications_sample_task_body },
  { title: m.notifications_sample_approval_title, body: m.notifications_sample_approval_body },
  { title: m.notifications_sample_import_title, body: m.notifications_sample_import_body },
  { title: m.notifications_sample_digest_title, body: m.notifications_sample_digest_body },
]
const EVERY_MS = 3200

/**
 * Examples of what arrives, one after another, drawn like a system notification banner. The
 * background keeps its height, so the step below does not move as they change.
 */
export function NotificationPreview() {
  const preference = useMotionPreference()
  // Reduced motion: the first example stays put instead of sliding through the others.
  const still = useReducedMotion()
  const [index, setIndex] = useState(0)
  useEffect(() => {
    if (still) return
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % SAMPLES.length), EVERY_MS)
    return () => window.clearInterval(timer)
  }, [still])
  const sample = SAMPLES[still ? 0 : index]!
  return (
    <div
      aria-hidden
      className="relative flex h-44 items-center justify-center overflow-hidden rounded-3xl bg-muted/60 px-6"
    >
      <MotionConfig reducedMotion={preference}>
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            key={index}
            initial={{ opacity: 0, y: -24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className="flex w-full max-w-lg items-start gap-3 rounded-2xl border bg-card px-3 py-2 shadow-sm"
          >
            <img src="/icons/icon-192.png" alt="" className="mt-0.5 size-8 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-sm font-medium">{sample.title()}</p>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {m.notifications_sample_now()}
                </span>
              </div>
              <p className="truncate text-sm text-muted-foreground">{sample.body()}</p>
            </div>
          </motion.div>
        </AnimatePresence>
      </MotionConfig>
    </div>
  )
}
