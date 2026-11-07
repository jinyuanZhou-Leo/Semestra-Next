import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'

/**
 * A grades table (a course's assessments, a term's courses) with its toolbar above it: filters
 * on the left and actions on the right, or the plan bar in plan mode. The card holds only the
 * table, so its column headings are its only header.
 */
export function GradeTableCard({
  toolbar,
  children,
}: {
  planning?: boolean
  /** The row above the table; always 2rem high so plan mode never moves the table. */
  toolbar: ReactNode
  children: ReactNode
}) {
  return (
    <div className="min-w-0 space-y-3">
      {toolbar}
      <div className="rounded-2xl border border-border">{children}</div>
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
      <h2 className="text-sm font-medium">{m.grading_planning()}</h2>
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
