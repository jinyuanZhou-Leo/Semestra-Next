import { type ReactNode, createContext, useContext, useState } from 'react'
import { AnimatedNumber } from '@/components/AnimatedNumber'
import { formatGpa } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { GRADE_MASK, percentText } from '../display'

const HideGradesContext = createContext(false)

/**
 * Whether the Program hides grades, provided once by the page or card that loaded the data.
 * Everything below reads it with `useHideGrades` instead of being handed a flag.
 */
export function HideGrades({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  return <HideGradesContext value={hidden}>{children}</HideGradesContext>
}

export function useHideGrades(): boolean {
  return useContext(HideGradesContext)
}

/** Shown while the pointer is over it or it has focus, so the keyboard and a tap can show it too. */
function useReveal() {
  const [shown, setShown] = useState(false)
  return {
    shown,
    handlers: {
      onPointerEnter: () => setShown(true),
      onPointerLeave: () => setShown(false),
      onFocus: () => setShown(true),
      onBlur: () => setShown(false),
    },
  }
}

/**
 * What hides a grade while the Program hides grades: "•••" in its place, the grade itself while
 * the pointer is over it or it has focus (so a touch screen can tap it). Without hiding it is
 * just `children`.
 */
export function Concealed({ children, className }: { children: ReactNode; className?: string }) {
  const hidden = useHideGrades()
  const { shown, handlers } = useReveal()
  if (!hidden) return children
  return (
    <span
      // Focusable so the keyboard and touch can show it too (it is not a control).
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      aria-label={shown ? undefined : m.grading_gpa_show()}
      className={cn('rounded-sm outline-offset-2', className)}
      {...handlers}
    >
      {shown ? children : GRADE_MASK}
    </span>
  )
}

/**
 * A chart that shows only while the pointer is over it or it has focus. The chart is always
 * there and a placeholder covers it, so the placeholder is as large as the chart whatever the
 * chart holds, showing it moves nothing, and the chart is not drawn anew on every hover.
 */
export function ConcealedChart({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const hidden = useHideGrades()
  const { shown, handlers } = useReveal()
  if (!hidden) return children
  return (
    <div
      // Focusable so the keyboard and touch can show it too (it is not a control).
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      aria-label={shown ? undefined : m.grading_gpa_show()}
      className={cn('relative rounded-sm outline-offset-2', className)}
      {...handlers}
    >
      {/* Out of sight and out of the accessibility tree, tooltips included, until shown. */}
      <div aria-hidden={!shown} className={shown ? undefined : 'invisible'}>
        {children}
      </div>
      {shown ? null : (
        <span
          aria-hidden
          className="absolute inset-0 grid place-items-center rounded-xl border border-dashed text-muted-foreground"
        >
          {GRADE_MASK}
        </span>
      )}
    </div>
  )
}

/**
 * A percentage (0–100); while the Program hides grades it shows as "•••" until
 * hovered (M03 §5.3).
 */
export function PercentValue({
  value,
  animated = false,
  className,
}: {
  value: number | null | undefined
  /** Roll the digits (headline figures, not tables). */
  animated?: boolean
  className?: string
}) {
  if (value == null) return <span className={className}>—</span>
  return (
    <Concealed className={className}>
      {animated ? (
        <AnimatedNumber value={value} format={percentText} className={className} />
      ) : (
        <span className={className}>{percentText(value)}</span>
      )}
    </Concealed>
  )
}

/**
 * A GPA number and its letter grade; while the Program hides grades both show as one
 * "•••" until hovered (M03 §5.3).
 */
export function GpaValue({
  value,
  letter,
  letterClassName,
  animated = false,
  className,
}: {
  value: number | null | undefined
  /** The band's letter, shown after the number and masked with it. */
  letter?: string | null
  letterClassName?: string
  /** Roll the digits (headline figures on overview cards, not tables). */
  animated?: boolean
  className?: string
}) {
  if (value == null) return <span className={className}>—</span>
  const number = animated ? (
    <AnimatedNumber value={value} format={formatGpa} className={className} />
  ) : (
    <span className={className}>{formatGpa(value)}</span>
  )
  return (
    <Concealed className={className}>
      {number}
      {letter ? <span className={letterClassName}>{letter}</span> : null}
    </Concealed>
  )
}
