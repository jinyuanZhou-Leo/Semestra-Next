import type { GradebookSummary } from '@semestra/api-client'
import type { ReactNode } from 'react'
import { m } from '@/paraglide/messages'
import { percentText } from '../display'

export function Stat({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{children}</div>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/** The target in words: what the remaining work has to average, or that it is settled. */
export function requiredText(s: Pick<GradebookSummary, 'reachable' | 'required_average'>): string {
  if (s.reachable === false) return m.grading_required_unreachable()
  if (s.required_average === null) return '—'
  if (s.required_average <= 0) return m.grading_required_secured()
  return percentText(s.required_average)
}
