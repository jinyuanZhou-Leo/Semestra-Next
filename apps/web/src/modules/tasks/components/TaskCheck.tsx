import type { Task, TaskPage } from '@semestra/api-client'
import { tasksItemCompleteMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Checkbox } from '@/ui/checkbox'
import { courseTasksOptions, invalidateTasks } from '../queries'

/**
 * A to-do's round check, as on the to-do list, in another module's table of a course (the
 * gradebook's to-do column, the Canvas tab's assignments). Checking it off pops the circle
 * (`data-completing` in theme.css) and updates the course's to-dos at once.
 */
export function TaskCheck({ task, courseId }: { task: Task; courseId: string }) {
  const queryClient = useQueryClient()
  const { queryKey } = courseTasksOptions(task.program_id, courseId)
  const [popped, setPopped] = useState(false)
  const complete = useMutation({
    ...tasksItemCompleteMutation(),
    onMutate: async ({ path, body }) => {
      await queryClient.cancelQueries({ queryKey })
      const before = queryClient.getQueryData<TaskPage>(queryKey)
      if (before) {
        const completed_at = body.completed ? new Date().toISOString() : null
        queryClient.setQueryData<TaskPage>(queryKey, {
          ...before,
          items: before.items.map((t) => (t.id === path.task_id ? { ...t, completed_at } : t)),
        })
      }
      return before
    },
    onError: (error, _vars, before) => {
      if (before) queryClient.setQueryData(queryKey, before)
      toastError(error)
    },
    onSettled: () => invalidateTasks(queryClient),
  })
  return (
    <span data-completing={popped ? 'checking' : undefined} className="flex">
      <Checkbox
        aria-label={m.tasks_complete({ title: task.title })}
        checked={task.completed_at !== null}
        onCheckedChange={(completed) => {
          setPopped(completed)
          complete.mutate({ path: { task_id: task.id }, body: { completed } })
        }}
        onClick={(event) => event.stopPropagation()}
        className="task-check size-4.5 rounded-full"
      />
    </span>
  )
}
