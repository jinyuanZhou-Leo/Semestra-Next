import type { Task } from '@semestra/api-client'
import {
  settingsValuesGetOptions,
  tasksCountsOptions,
  tasksItemQueryOptions,
  tasksListListOptions,
} from '@semestra/api-client/react-query'
import { type QueryClient, useQuery } from '@tanstack/react-query'
import type { SortKey, Selection } from './types'

const STALE = 15_000

/** What a tasks view is limited to: a Program, plus a term or a course. */
export type TaskScope = { programId: string; termId?: string; courseId?: string }

export function useTaskLists(programId: string) {
  return useQuery({
    ...tasksListListOptions({ path: { program_id: programId } }),
    staleTime: STALE,
  })
}

export function useTaskCounts(scope: TaskScope) {
  return useQuery({
    ...tasksCountsOptions({
      path: { program_id: scope.programId },
      query: { term_id: scope.termId, course_id: scope.courseId },
    }),
    staleTime: STALE,
  })
}

/** The tasks of a selection (smart list, inbox or list) within a scope. */
export function useTasks(
  scope: TaskScope,
  selection: Selection,
  { sort, includeCompleted }: { sort: SortKey; includeCompleted: boolean },
) {
  return useQuery({
    ...tasksItemQueryOptions({
      path: { program_id: scope.programId },
      query: {
        view:
          selection.kind === 'smart'
            ? selection.view
            : selection.kind === 'inbox'
              ? 'inbox'
              : 'all',
        list_id: selection.kind === 'list' ? selection.listId : undefined,
        term_id: scope.termId,
        course_id: selection.kind === 'course' ? selection.courseId : scope.courseId,
        sort,
        include_completed: includeCompleted,
        limit: 500,
      },
    }),
    staleTime: STALE,
  })
}

/** The unfinished tasks due today or overdue, for the Today card. */
export function useTodayTasks(programId: string) {
  return useQuery({
    ...tasksItemQueryOptions({
      path: { program_id: programId },
      query: { view: 'today', sort: 'due', limit: 100 },
    }),
    staleTime: STALE,
  })
}

function operationId(queryKey: readonly unknown[]): string {
  // oxlint-disable-next-line no-underscore-dangle -- hey-api's query key field
  return String((queryKey[0] as { _id?: unknown } | undefined)?._id ?? '')
}

/** Refetch everything the tasks module shows, after a change made from this tab. */
export function invalidateTasks(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    predicate: (query) => operationId(query.queryKey).startsWith('tasks'),
  })
}

export type { Task }

export type TaskSettings = {
  auto_tasks_from_assessments: boolean
  default_priority: Task['priority']
  show_completed_in_lists: boolean
}

export const DEFAULT_TASK_SETTINGS: TaskSettings = {
  auto_tasks_from_assessments: false,
  default_priority: 'none',
  show_completed_in_lists: false,
}

/** The `tasks` namespace (M11), resolved for a Program. */
export function useTaskSettings(programId: string): TaskSettings {
  const values = useQuery({
    ...settingsValuesGetOptions({
      path: { namespace: 'tasks' },
      query: { scope_type: 'program', scope_id: programId },
    }),
    staleTime: STALE,
  }).data?.values
  return { ...DEFAULT_TASK_SETTINGS, ...(values as Partial<TaskSettings> | undefined) }
}
