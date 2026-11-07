import type { Assessment, Task, TaskPage } from '@semestra/api-client'
import { tasksItemCompleteMutation, tasksItemQueryOptions } from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Checkbox } from '@/ui/checkbox'
import { invalidateTasks } from '../queries'

/** A course's tasks by the assessment they belong to; one request for all rows of a gradebook. */
function courseTasks(programId: string, courseId: string) {
  return tasksItemQueryOptions({
    path: { program_id: programId },
    query: { course_id: courseId, completed: 'include', limit: 500 },
  })
}

const byAssessment = (page: TaskPage): ReadonlyMap<string, Task> =>
  new Map(page.items.flatMap((t) => (t.assessment_id ? [[t.assessment_id, t] as const] : [])))

/**
 * The gradebook's to-do column (M05 §5, contributed to `grading.assessmentColumns`): the
 * assessment's to-do, checked off in place, or a dash when it has no due date (and so no to-do).
 */
export default function AssessmentTaskCell({
  assessment,
  programId,
}: {
  assessment: Assessment
  programId: string
}) {
  const queryClient = useQueryClient()
  const options = courseTasks(programId, assessment.course_id)
  const { data } = useQuery({ ...options, select: byAssessment })
  // Checking it off pops the circle as on the to-do list (`data-completing` in theme.css).
  const [popped, setPopped] = useState(false)
  const complete = useMutation({
    ...tasksItemCompleteMutation(),
    onMutate: async ({ path, body }) => {
      await queryClient.cancelQueries({ queryKey: options.queryKey })
      const before = queryClient.getQueryData<TaskPage>(options.queryKey)
      if (before) {
        const completed_at = body.completed ? new Date().toISOString() : null
        queryClient.setQueryData<TaskPage>(options.queryKey, {
          ...before,
          items: before.items.map((t) => (t.id === path.task_id ? { ...t, completed_at } : t)),
        })
      }
      return before
    },
    onError: (error, _vars, before) => {
      if (before) queryClient.setQueryData(options.queryKey, before)
      toastError(error)
    },
    onSettled: () => invalidateTasks(queryClient),
  })
  if (!data) return null
  const task = data.get(assessment.id)
  if (!task) return <span className="text-muted-foreground">—</span>
  return (
    <span data-completing={popped ? 'checking' : undefined} className="flex">
      <Checkbox
        aria-label={m.tasks_complete({ title: task.title })}
        checked={task.completed_at !== null}
        onCheckedChange={(completed) => {
          setPopped(completed)
          complete.mutate({ path: { task_id: task.id }, body: { completed } })
        }}
        className="task-check size-4.5 rounded-full"
      />
    </span>
  )
}
