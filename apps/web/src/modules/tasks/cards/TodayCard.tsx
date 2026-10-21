import type { CardProps } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { useTaskActions } from '../actions'
import { CompactTasks } from '../components/CompactTasks'
import { QuickAdd } from '../components/QuickAdd'
import { useProgramToday, useTodayTasks } from '../queries'

/** Tasks due today and overdue ones, with quick add (M05 §5.3). */
export default function TodayCard({ scope, size }: CardProps) {
  const tasks = useTodayTasks(scope.programId).data?.items
  const actions = useTaskActions()
  const today = useProgramToday(scope.programId)
  if (!tasks) return null
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <CompactTasks
          programId={scope.programId}
          tasks={tasks}
          actions={actions}
          emptyTitle={m.tasks_today_empty()}
        />
      </div>
      {size === 'm' ? null : (
        <QuickAdd
          today={today}
          defaultDue={today}
          disabled={actions.pending}
          onAdd={(task) =>
            actions.create(scope.programId, {
              ...task,
              term_id: scope.kind === 'term' ? scope.termId : undefined,
              course_id: scope.kind === 'course' ? scope.courseId : undefined,
            })
          }
        />
      )}
    </div>
  )
}
