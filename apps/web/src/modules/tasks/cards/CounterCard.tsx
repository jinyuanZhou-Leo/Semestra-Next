import { CardSkeleton } from '@/app/board/CardSkeleton'
import type { CardProps } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { useTaskCounts } from '../queries'

/** How many tasks are open and how many are overdue (M05 §5.3). */
export default function CounterCard({ scope }: CardProps) {
  const counts = useTaskCounts({
    programId: scope.programId,
    termId: scope.kind === 'term' ? scope.termId : undefined,
  }).data
  if (!counts) return <CardSkeleton />
  return (
    <div className="flex h-full flex-col justify-center">
      <span className="font-heading text-3xl font-semibold tabular-nums">{counts.all}</span>
      <span className="text-xs text-muted-foreground">{m.tasks_counter_open()}</span>
      {counts.overdue > 0 ? (
        <span className="text-xs text-destructive">
          {m.tasks_counter_overdue({ count: counts.overdue })}
        </span>
      ) : null}
    </div>
  )
}
