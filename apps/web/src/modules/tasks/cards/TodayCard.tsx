import type { CardProps } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { useTaskActions } from '../actions'
import { CompactTasks } from '../components/CompactTasks'
import { QuickAdd } from '../components/QuickAdd'
import { useTodayTasks } from '../queries'

function localToday(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** Tasks due today and overdue ones, with quick add (M05 §5.3). */
export default function TodayCard({ scope, size }: CardProps) {
  const tasks = useTodayTasks(scope.programId).data?.items
  const actions = useTaskActions()
  if (!tasks) return null
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <CompactTasks tasks={tasks} actions={actions} emptyTitle={m.tasks_today_empty()} />
      </div>
      {size === 'm' ? null : (
        <QuickAdd
          defaultDue={localToday()}
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
