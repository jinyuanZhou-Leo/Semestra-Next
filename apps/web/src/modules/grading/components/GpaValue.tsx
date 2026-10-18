import { useState } from 'react'
import { formatGpa } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { GPA_MASK } from '../display'

/** A GPA number; with `hidden` (the Program hides GPA) it shows "•••" until clicked (M03 §5.3). */
export function GpaValue({
  value,
  hidden,
  className,
}: {
  value: number | null | undefined
  hidden: boolean
  className?: string
}) {
  const [revealed, setRevealed] = useState(false)
  if (value == null) return <span className={className}>—</span>
  if (hidden && !revealed) {
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
          setRevealed(true)
        }}
      >
        {GPA_MASK}
      </Button>
    )
  }
  return <span className={className}>{formatGpa(value)}</span>
}
