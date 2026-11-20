import type { Course, Task } from '@semestra/api-client'
import { cn } from '@/lib/utils'
import { courseColor, courseLabel } from '@/modules/academics/color'
import { m } from '@/paraglide/messages'
import { Checkbox } from '@/ui/checkbox'
import type { TaskActions } from '../actions'
import { useCompleting } from '../completion'
import { MotionLi, useRowPresence } from '../components/presence'
import { PRIORITY_NAMES, PriorityMarks } from '../components/priority'
import { dueLabel } from '../due'
import { TaskLinks } from '../components/TaskLinks'
import { shownPriority } from '../types'

/**
 * A task on a phone (M17): the circle checks it off (it waits in place, as on the desktop), the
 * rest of the row opens its details; at its end, a way to what it came from (`tasks.links`).
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
  const presence = useRowPresence(task.id, { minHeight: 56 })
  return (
    <MotionLi
      {...presence}
      data-completing={completing ?? undefined}
      className="relative flex min-h-14 items-center gap-3 pl-4"
    >
      <Checkbox
        checked={done}
        aria-label={m.tasks_complete({ title: task.title })}
        // A finger-sized target around the small circle.
        className="task-check relative z-10 size-5 rounded-full after:absolute after:-inset-3"
        onCheckedChange={(checked) => void actions.complete(task.id, checked)}
      />
      <div className="flex min-w-0 flex-1 items-center gap-2 self-stretch py-2.5 pr-4">
        <div className="min-w-0 flex-1">
          {/* The whole row opens the details: the title's button is stretched over it. */}
          <button
            type="button"
            className={cn(
              'block w-full truncate text-left after:absolute after:inset-0',
              done && 'text-muted-foreground',
            )}
            onClick={() => onOpen(task)}
          >
            <span className="task-title">{task.title}</span>
          </button>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground empty:hidden">
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
                className={cn('shrink-0 tabular-nums', task.overdue && !done && 'text-destructive')}
              >
                {due}
              </span>
            ) : null}
            <TaskLinks task={task} shape="pill" className="relative z-10 h-7 px-2.5" />
          </div>
        </div>
        {priority === 'none' ? null : (
          <>
            <PriorityMarks level={priority} className="min-w-0 text-base" />
            <span className="sr-only">
              {m.tasks_priority_label({ priority: PRIORITY_NAMES[priority]() })}
            </span>
          </>
        )}
      </div>
    </MotionLi>
  )
}
