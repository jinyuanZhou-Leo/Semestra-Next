import { AnimatePresence, LazyMotion, domAnimation } from 'motion/react'
import * as motionM from 'motion/react-m'
import { type ReactNode, createContext, useContext } from 'react'
import { useReducedMotion } from '@/app/theme'

/** A task row that opens and closes as it comes and goes (`useRowPresence`). */
export const MotionLi = motionM.li
/** A group of rows (the phone's due-date sections), which opens and closes the same way. */
export const MotionDiv = motionM.div

/**
 * What a row leaving the list is told: the tasks still listed (a row that is only scrolled out
 * of a virtual list goes at once), or that the whole list changed (another list was picked).
 */
export type ExitContext = { listed?: ReadonlySet<string>; instant?: boolean }

const ReducedMotion = createContext(false)
const EASE = [0.32, 0.72, 0, 1] as const
const DURATION = 0.24

/**
 * The rows of a task list, which open in place when a task is added and close up when one goes
 * (checked off, deleted, moved elsewhere), so the rows around them slide instead of jumping
 * (M05 §5.1). Rows already there when the list first shows do not animate.
 */
export function TaskListPresence({ exit, children }: { exit?: ExitContext; children: ReactNode }) {
  const reduced = useReducedMotion()
  return (
    <LazyMotion features={domAnimation} strict>
      <ReducedMotion value={reduced}>
        <AnimatePresence initial={false} custom={exit}>
          {children}
        </AnimatePresence>
      </ReducedMotion>
    </LazyMotion>
  )
}

/**
 * The motion props of a task row (`MotionLi`): it opens from nothing when `enter` and closes up
 * when it leaves. `padY` and `minHeight` are the row's own (its classes), which close up with it.
 */
export function useRowPresence(
  /** The task; null for a group of rows, which always closes up as it goes. */
  taskId: string | null,
  { enter = true, padY = 0, minHeight = 0 }: { enter?: boolean; padY?: number; minHeight?: number },
) {
  const reduced = useContext(ReducedMotion)
  // Content-box sizing while it opens: `height: auto` is measured without the padding that opens
  // along with it, so the row ends at its full height instead of jumping by the padding.
  const closed = {
    boxSizing: 'content-box',
    height: 0,
    minHeight: 0,
    paddingTop: 0,
    paddingBottom: 0,
    opacity: 0,
    overflow: 'hidden',
  }
  const transition = { duration: reduced ? 0 : DURATION, ease: EASE }
  return {
    initial: enter && !reduced ? 'closed' : false,
    animate: 'open',
    exit: 'gone',
    variants: {
      closed,
      open: {
        boxSizing: 'content-box',
        height: 'auto',
        minHeight,
        paddingTop: padY,
        paddingBottom: padY,
        opacity: 1,
        overflow: 'hidden',
        transition,
        // Unclipped once open: focus rings and a dragged row's shadow show in full.
        transitionEnd: { overflow: 'visible' },
      },
      gone: (context: ExitContext | undefined) =>
        context?.instant || (taskId !== null && context?.listed?.has(taskId))
          ? { transition: { duration: 0 } }
          : { ...closed, transition },
    },
  } as const
}
