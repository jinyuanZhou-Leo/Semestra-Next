import { useState } from 'react'
import { AnimatedNumber } from '@/components/AnimatedNumber'
import { formatGpa } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { GRADE_MASK, percentText } from '../display'

/** The "•••" that stands in for a grade while the Program hides grades; selecting it shows the value. */
function MaskButton({ className, onReveal }: { className?: string; onReveal: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      aria-label={m.grading_gpa_show()}
      className={cn(
        'h-auto px-1 py-0 text-[length:inherit] font-[inherit] hover:bg-muted',
        className,
      )}
      onClick={(event) => {
        // Cards wrap their figures in a link; revealing must not follow it.
        event.preventDefault()
        event.stopPropagation()
        onReveal()
      }}
    >
      {GRADE_MASK}
    </Button>
  )
}

/** A chart's placeholder while the Program hides grades; the whole figure is revealed at once. */
export function MaskedChart({ className, onReveal }: { className?: string; onReveal: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      className={cn('w-full rounded-xl border-dashed font-normal text-muted-foreground', className)}
      aria-label={m.grading_gpa_show()}
      onClick={onReveal}
    >
      {GRADE_MASK}
    </Button>
  )
}

/**
 * A percentage (0–100); with `hidden` (the Program hides grades) it shows as "•••" until
 * clicked (M03 §5.3).
 */
export function PercentValue({
  value,
  hidden,
  animated = false,
  className,
}: {
  value: number | null | undefined
  hidden: boolean
  /** Roll the digits (headline figures, not tables). */
  animated?: boolean
  className?: string
}) {
  const [revealed, setRevealed] = useState(false)
  if (value == null) return <span className={className}>—</span>
  if (hidden && !revealed)
    return <MaskButton className={className} onReveal={() => setRevealed(true)} />
  return animated ? (
    <AnimatedNumber value={value} format={percentText} className={className} />
  ) : (
    <span className={className}>{percentText(value)}</span>
  )
}

/**
 * A GPA number and its letter grade; with `hidden` (the Program hides grades) both show as one
 * "•••" until clicked (M03 §5.3).
 */
export function GpaValue({
  value,
  hidden,
  letter,
  letterClassName,
  animated = false,
  className,
}: {
  value: number | null | undefined
  hidden: boolean
  /** The band's letter, shown after the number and masked with it. */
  letter?: string | null
  letterClassName?: string
  /** Roll the digits (headline figures on overview cards, not tables). */
  animated?: boolean
  className?: string
}) {
  const [revealed, setRevealed] = useState(false)
  if (value == null) return <span className={className}>—</span>
  if (hidden && !revealed)
    return <MaskButton className={className} onReveal={() => setRevealed(true)} />
  const number = animated ? (
    <AnimatedNumber value={value} format={formatGpa} className={className} />
  ) : (
    <span className={className}>{formatGpa(value)}</span>
  )
  if (!letter) return number
  return (
    <>
      {number}
      <span className={letterClassName}>{letter}</span>
    </>
  )
}
