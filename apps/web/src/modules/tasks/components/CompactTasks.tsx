import type { Task } from '@semestra/api-client'
import { CircleCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Checkbox } from '@/ui/checkbox'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import type { TaskActions } from '../actions'
import { useCompleting } from '../completion'
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
        <CompactTask key={task.id} task={task} today={today} actions={actions} />
      ))}
    </ul>
  )
}

function CompactTask({
  task,
  today,
  actions,
}: {
  task: Task
  today: string
  actions: TaskActions
}) {
  // Just checked off: shown done, still in its place until it is saved (`completion.ts`).
  const completing = useCompleting(task.id)
  const done = task.completed_at !== null || completing !== null
  return (
    <li
      data-completing={completing ?? undefined}
      className="flex items-center gap-2 rounded-lg px-2 py-1.5"
    >
      <Checkbox
        checked={done}
        aria-label={m.tasks_complete({ title: task.title })}
        className="task-check size-4.5 rounded-full"
        onCheckedChange={(checked) => void actions.complete(task.id, checked)}
      />
      <span className={cn('min-w-0 flex-1 truncate text-sm', done && 'text-muted-foreground')}>
        <span className="task-title">{task.title}</span>
      </span>
      <TaskPriority priority={task.priority} />
      {task.due_date ? (
        <span
          className={cn(
            'shrink-0 text-xs tabular-nums',
            task.overdue && !done ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {dueLabel(task, today)}
        </span>
      ) : null}
    </li>
  )
}
