import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The layout of a number card (term GPA, course grade, open tasks): a label, the number, and
 * details pinned to the bottom, at the same places on every such card so cards side by side line
 * up. On a small card the label is the card's name (the host hides the title row there).
 */
export function CardStat({
  label,
  value,
  footer,
  className,
}: {
  label?: ReactNode
  value: ReactNode
  footer?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex h-full min-w-0 flex-col', className)}>
      {label ? <p className="truncate text-xs text-muted-foreground">{label}</p> : null}
      <div className="mt-1 font-heading text-3xl leading-tight font-semibold tabular-nums">
        {value}
      </div>
      {footer ? (
        <div className="mt-auto space-y-0.5 pt-2 text-xs text-muted-foreground">{footer}</div>
      ) : null}
    </div>
  )
}
