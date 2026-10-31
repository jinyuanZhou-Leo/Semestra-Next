import type { Task } from '@semestra/api-client'
import {
  settingsValueGetOptions,
  tasksItemCountOptions,
  tasksItemQueryOptions,
  tasksListListOptions,
} from '@semestra/api-client/react-query'
import { type QueryClient, useQuery } from '@tanstack/react-query'
import { useProgram } from '@/modules/academics/queries'
import { todayIn } from '@/modules/schedule/time'
import type { Scope } from '@/app/extensions'
import type { SortKey, Selection } from './types'

const STALE = 15_000

/** What a tasks view is limited to: a Program, plus a term or a course. */
export type TaskScope = { programId: string; termId?: string; courseId?: string }

export function useTaskLists(programId: string) {
  return useQuery({
    ...tasksListListOptions({ path: { program_id: programId } }),
    staleTime: STALE,
    enabled: programId !== '',
  })
}

export function useTaskCounts(scope: TaskScope) {
  return useQuery({
    ...tasksItemCountOptions({
      path: { program_id: scope.programId },
      query: { term_id: scope.termId, course_id: scope.courseId },
    }),
    staleTime: STALE,
  })
}

/**
 * The tasks of a selection (smart list, Unsorted or list) within a scope: the open ones, or with
 * `completed: 'only'` the finished ones the selection would show. The first `limit` of them;
 * `total` counts them all.
 */
export function useTasks(
  scope: TaskScope,
  selection: Selection,
  { sort, completed, limit = 500 }: { sort: SortKey; completed: 'hide' | 'only'; limit?: number },
  enabled = true,
) {
  const options = tasksItemQueryOptions({
    path: { program_id: scope.programId },
    query: {
      view:
        selection.kind === 'smart' ? selection.view : selection.kind === 'inbox' ? 'inbox' : 'all',
      list_id: selection.kind === 'list' ? selection.listId : undefined,
      term_id: scope.termId,
      course_id: selection.kind === 'course' ? selection.courseId : scope.courseId,
      sort,
      completed: completed === 'only' ? 'only' : undefined,
      limit,
    },
  })
  return useQuery({
    ...options,
    staleTime: STALE,
    enabled,
    // Showing more keeps the rows already shown while the longer page loads; any other change
    // (another list, sort or scope) starts empty rather than showing the wrong tasks.
    placeholderData: (previous, previousQuery) =>
      previousQuery && sameButLimit(previousQuery.queryKey, options.queryKey)
        ? previous
        : undefined,
  })
}

function sameButLimit(a: readonly unknown[], b: readonly unknown[]): boolean {
  const strip = (key: readonly unknown[]) => {
    const head = key[0] as KeyHead
    const { limit: _limit, ...query } = head?.query ?? {}
    return JSON.stringify([{ ...head, query }, ...key.slice(1)])
  }
  return strip(a) === strip(b)
}

/** The unfinished tasks due today or overdue, for the Today card (of a term: that term's). */
function todayTasksOptions(programId: string, termId?: string) {
  return {
    ...tasksItemQueryOptions({
      path: { program_id: programId },
      query: { view: 'today', term_id: termId, sort: 'due', limit: 100 },
    }),
    staleTime: STALE,
  }
}

export function useTodayTasks(programId: string, termId?: string) {
  return useQuery(todayTasksOptions(programId, termId))
}

/** The unfinished tasks due between two dates, both included (the phone's Today, M17). */
export function useTasksDueBetween(programId: string, from: string, to: string) {
  return useQuery({
    ...tasksItemQueryOptions({
      path: { program_id: programId },
      query: { view: 'scheduled', due_from: from, due_to: to, sort: 'due', limit: 100 },
    }),
    staleTime: STALE,
  })
}

/** The Today card's data (`CardContribution.prefetch`). */
export function prefetchTodayTasks(scope: Scope, queryClient: QueryClient) {
  const termId = scope.kind === 'term' ? scope.termId : undefined
  void queryClient.prefetchQuery(todayTasksOptions(scope.programId, termId))
}

type KeyHead = { _id?: unknown; query?: Record<string, unknown> } | undefined

function operationId(queryKey: readonly unknown[]): string {
  // oxlint-disable-next-line no-underscore-dangle -- hey-api's query key field
  return String((queryKey[0] as KeyHead)?._id ?? '')
}

/** Reading the task-list query keys the generated client builds. */
export const taskQueryKeys = {
  isItemQuery: (queryKey: readonly unknown[]) => operationId(queryKey) === 'tasksItemQuery',
  params: (queryKey: readonly unknown[]) =>
    ((queryKey[0] as KeyHead)?.query ?? {}) as {
      view?: string
      completed?: 'exclude' | 'include' | 'only'
      sort?: string
    },
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
    ...settingsValueGetOptions({
      path: { namespace: 'tasks' },
      query: { scope_type: 'program', scope_id: programId },
    }),
    staleTime: STALE,
  }).data?.values
  return { ...DEFAULT_TASK_SETTINGS, ...(values as Partial<TaskSettings> | undefined) }
}

function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/** The Program's time zone, which the backend counts today and overdue in. */
export function useProgramTimezone(programId: string): string {
  return useProgram(programId).data?.timezone ?? deviceTimeZone()
}

/** Today's date in the Program's time zone. */
export function useProgramToday(programId: string): string {
  return todayIn(useProgramTimezone(programId))
}
