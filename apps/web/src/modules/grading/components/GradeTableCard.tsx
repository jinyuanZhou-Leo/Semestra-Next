import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'

/**
 * The bordered card around a grades table (a course's assessments, a term's courses): its header
 * bar holds the title and actions, and the card turns to the plan color in plan mode.
 */
export function GradeTableCard({
  planning,
  toolbar,
  children,
}: {
  planning: boolean
  /** The header bar (title and actions), inside the border. */
  toolbar: ReactNode
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-2xl border border-border transition-colors',
        planning && 'border-primary/30',
      )}
    >
      <div
        className={cn(
          'border-b border-border px-3 py-2 transition-colors',
          planning && 'border-primary/30',
        )}
      >
        {toolbar}
      </div>
      {children}
    </div>
  )
}

/**
 * What the header bar shows in plan mode, in place of the usual title and actions, the way a
 * table's selection actions replace its filters; its height never changes.
 */
export function PlanBar({
  hint,
  hasAssumptions,
  onClearAssumptions,
  onExit,
}: {
  hint: string
  hasAssumptions: boolean
  onClearAssumptions: () => void
  onExit: () => void
}) {
  return (
    <div className="flex h-8 items-center gap-2">
      <Badge>{m.grading_planning()}</Badge>
      <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{hint}</p>
      <Button
        variant="destructive"
        size="sm"
        disabled={!hasAssumptions}
        onClick={onClearAssumptions}
      >
        {m.grading_plan_clear()}
      </Button>
      <Button variant="destructive" size="sm" onClick={onExit}>
        <X aria-hidden />
        {m.grading_plan_exit()}
      </Button>
    </div>
  )
}
