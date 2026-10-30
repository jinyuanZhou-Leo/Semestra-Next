import type { Course, Task } from '@semestra/api-client'
import { cn } from '@/lib/utils'
import { courseColor, courseLabel } from '@/modules/academics/color'
import { m } from '@/paraglide/messages'
import { Checkbox } from '@/ui/checkbox'
import type { TaskActions } from '../actions'
import { useCompleting } from '../completion'
import { PRIORITY_NAMES, PriorityMarks } from '../components/priority'
import { dueLabel } from '../due'
import { shownPriority } from '../types'

/**
 * A task on a phone (M17): the circle checks it off (it waits in place, as on the desktop), the
 * rest of the row opens its details.
 */
export function TaskItem({
  task,
  course,
  today,
  actions,
  onOpen,
}: {
  task: Task
  course: Course | undefined
  today: string
  actions: TaskActions
  onOpen: (task: Task) => void
}) {
  const completing = useCompleting(task.id)
  const done = task.completed_at !== null || completing !== null
  const due = dueLabel(task, today)
  const priority = shownPriority(task.priority)
  return (
    <li data-completing={completing ?? undefined} className="flex min-h-14 items-center gap-3 pl-4">
      <Checkbox
        checked={done}
        aria-label={m.tasks_complete({ title: task.title })}
        // A finger-sized target around the small circle.
        className="task-check relative size-5 rounded-full after:absolute after:-inset-3"
        onCheckedChange={(checked) => void actions.complete(task.id, checked)}
      />
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 self-stretch py-2.5 pr-4 text-left"
        onClick={() => onOpen(task)}
      >
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate', done && 'text-muted-foreground')}>
            <span className="task-title">{task.title}</span>
          </span>
          {course || due ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {course ? (
                <>
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: courseColor(course) }}
                  />
                  <span className="truncate">{courseLabel(course)}</span>
                </>
              ) : null}
              {course && due ? <span aria-hidden>·</span> : null}
              {due ? (
                <span
                  className={cn(
                    'shrink-0 tabular-nums',
                    task.overdue && !done && 'text-destructive',
                  )}
                >
                  {due}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
        {priority === 'none' ? null : (
          <>
            <PriorityMarks level={priority} className="min-w-0 text-base" />
            <span className="sr-only">
              {m.tasks_priority_label({ priority: PRIORITY_NAMES[priority]() })}
            </span>
          </>
        )}
      </button>
    </li>
  )
}
