import type { Task } from '@semestra/api-client'
import { CircleCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Checkbox } from '@/ui/checkbox'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import type { TaskActions } from '../actions'
import { dueLabel } from '../due'
import { useProgramToday } from '../queries'
import { TaskPriority } from './priority'

/** The tasks of a board card: check them off, nothing else. */
export function CompactTasks({
  programId,
  tasks,
  actions,
  emptyTitle,
}: {
  programId: string
  tasks: readonly Task[]
  actions: TaskActions
  emptyTitle: string
}) {
  const today = useProgramToday(programId)
  if (tasks.length === 0) {
    return (
      <Empty className="border-0 p-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CircleCheck aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{emptyTitle}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <ul>
      {tasks.map((task) => (
        <li key={task.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
          <Checkbox
            checked={task.completed_at !== null}
            aria-label={m.tasks_complete({ title: task.title })}
            className="size-4.5 rounded-full"
            onCheckedChange={(checked) => void actions.complete(task.id, checked)}
          />
          <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
          <TaskPriority priority={task.priority} />
          {task.due_date ? (
            <span
              className={cn(
                'shrink-0 text-xs tabular-nums',
                task.overdue ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {dueLabel(task, today)}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
