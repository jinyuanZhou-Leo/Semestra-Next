import { CardSkeleton } from '@/app/board/CardSkeleton'
import { CardStat } from '@/app/board/CardStat'
import type { CardProps } from '@/app/extensions'
import { HistoryLink } from '@/components/HistoryLink'
import { termPath } from '@/modules/academics/paths'
import { m } from '@/paraglide/messages'
import { useTaskCounts } from '../queries'

/** On term boards only. How many tasks are open, with those due today and overdue below (M05 §5.3). Opens the tasks. */
export default function CounterCard({ scope }: CardProps) {
  const termId = scope.kind === 'term' ? scope.termId : ''
  const counts = useTaskCounts({ programId: scope.programId, termId }).data
  if (!counts) return <CardSkeleton />
  return (
    <HistoryLink
      href={termPath(scope.programId, termId, 'tasks')}
      className="-mx-2 -my-1 flex h-full rounded-xl px-2 py-1 transition-colors hover:bg-muted/50"
    >
      <CardStat
        className="flex-1"
        label={m.tasks_card_counter()}
        value={counts.all}
        footer={
          <>
            <p>{m.tasks_counter_today({ count: counts.today })}</p>
            {counts.overdue > 0 ? (
              <p className="text-destructive">
                {m.tasks_counter_overdue({ count: counts.overdue })}
              </p>
            ) : null}
          </>
        }
      />
    </HistoryLink>
  )
}
