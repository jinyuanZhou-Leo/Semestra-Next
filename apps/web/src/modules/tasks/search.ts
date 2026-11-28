import { academicsProgramGetOptions, tasksItemFindOptions } from '@semestra/api-client/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { Scope, SearchResult } from '@/app/extensions'
import { coursePath } from '@/modules/academics/paths'
import { courseLabel } from '@/modules/academics/color'
import { courseListOptions } from '@/modules/academics/queries'
import { todayIn } from '@/modules/schedule/time'
import { m } from '@/paraglide/messages'
import { dueLabel } from './due'

const MAX_RESULTS = 5

/**
 * The command palette's tasks: the Program's, finished ones too, best match first. A task opens
 * on its course's tasks page, or the Program's, with its details shown (`?task=`).
 */
export async function searchTasks(
  query: string,
  scope: Scope | undefined,
  queryClient: QueryClient,
): Promise<SearchResult[]> {
  if (!scope) return []
  const { programId } = scope
  // Open tasks first: asked for on their own, so finished ones that match better cannot push
  // them out of the few lines shown; finished ones fill the rest.
  const find = (include_completed: boolean) =>
    queryClient.fetchQuery(
      tasksItemFindOptions({
        path: { program_id: programId },
        query: { query, include_completed, limit: MAX_RESULTS },
      }),
    )
  const [open, all, courses, program] = await Promise.all([
    find(false),
    find(true),
    queryClient.ensureQueryData(courseListOptions(programId)),
    queryClient.ensureQueryData(academicsProgramGetOptions({ path: { program_id: programId } })),
  ])
  const today = todayIn(program.timezone)
  const codes = new Map(courses.items.map((c) => [c.id, courseLabel(c)]))
  const ordered = [...open.items, ...all.items.filter((task) => task.completed)].slice(
    0,
    MAX_RESULTS,
  )
  return ordered.map((task) => {
    const course = task.course_id ? codes.get(task.course_id) : undefined
    const page = task.course_id
      ? coursePath(programId, task.course_id, 'tasks')
      : `/p/${programId}/tasks`
    return {
      id: task.task_id,
      title: task.title,
      subtitle: [
        // A gradebook task's title starts with its course already.
        course && !task.title.startsWith(course) ? course : null,
        task.completed
          ? m.tasks_view_completed()
          : dueLabel({ due_date: task.due_date, due_time: null }, today),
      ]
        .filter(Boolean)
        .join(' · '),
      to: `${page}?task=${encodeURIComponent(task.task_id)}`,
    }
  })
}
