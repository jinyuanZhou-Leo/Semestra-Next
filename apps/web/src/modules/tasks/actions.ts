import {
  type Task,
  type TaskCreateInputBody,
  type TaskPage,
  type TaskUpdateInputBody,
  tasksItemComplete,
} from '@semestra/api-client'
import {
  tasksItemClearCompletedMutation,
  tasksItemCompleteMutation,
  tasksItemCreateMutation,
  tasksItemDeleteMutation,
  tasksItemMoveMutation,
  tasksItemUpdateMutation,
  tasksListCreateMutation,
  tasksListDeleteMutation,
  tasksListReorderMutation,
  tasksListUpdateMutation,
} from '@semestra/api-client/react-query'
import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query'
import { toastError } from '@/lib/errors'
import { cancelCompletion, scheduleCompletion } from './completion'
import { invalidateTasks, taskQueryKeys } from './queries'

type Snapshot = [readonly unknown[], TaskPage | undefined][]

/** Changes the cached task pages in place; the returned snapshot puts them back on failure. */
function patchPages(
  queryClient: QueryClient,
  patch: (page: TaskPage, params: TaskQueryParams) => Task[],
): Snapshot {
  const snapshot: Snapshot = []
  for (const [key, page] of queryClient.getQueriesData<TaskPage>({
    predicate: (query) => taskQueryKeys.isItemQuery(query.queryKey),
  })) {
    if (!page) continue
    snapshot.push([key, page])
    const items = patch(page, taskQueryKeys.params(key))
    // A task that leaves a page leaves its total too.
    queryClient.setQueryData<TaskPage>(key, {
      ...page,
      items,
      total: page.total - (page.items.length - items.length),
    })
  }
  return snapshot
}

export type TaskQueryParams = { view?: string; only_completed?: boolean; sort?: string }

function restore(queryClient: QueryClient, snapshot: Snapshot | undefined) {
  for (const [key, page] of snapshot ?? []) queryClient.setQueryData(key, page)
}

/**
 * Every change a task view can make, each refreshing the task queries and toasting failures.
 * `actions` stays the same object while the mutations run, so the rows handed it are not
 * re-rendered; `pending` (adding, deleting or clearing in progress) is kept out of it for that.
 */
export function useTaskActions() {
  const queryClient = useQueryClient()
  const shared = { onError: toastError, onSettled: () => invalidateTasks(queryClient) }
  const create = useMutation({ ...tasksItemCreateMutation(), ...shared })
  // Edits, checking a task off and dragging it are applied to the cached lists right away, so
  // a chip or a flag changes as it is clicked.
  const update = useMutation({
    ...tasksItemUpdateMutation(),
    ...shared,
    onMutate: async ({ path, body }) => {
      await queryClient.cancelQueries({
        predicate: (query) => taskQueryKeys.isItemQuery(query.queryKey),
      })
      return patchPages(queryClient, (page) =>
        page.items.map((t) => (t.id === path.task_id ? ({ ...t, ...body } as Task) : t)),
      )
    },
    onError: (error, _vars, snapshot) => {
      restore(queryClient, snapshot)
      toastError(error)
    },
  })
  const complete = useMutation({
    ...tasksItemCompleteMutation(),
    ...shared,
    onMutate: async ({ path, body }) => {
      await queryClient.cancelQueries({
        predicate: (query) => taskQueryKeys.isItemQuery(query.queryKey),
      })
      // The task leaves the lists it no longer belongs to; the finished list fills on refetch.
      return patchPages(queryClient, (page, params) => {
        const showsFinished = params.only_completed === true || params.view === 'completed'
        return body.completed === showsFinished
          ? page.items
          : page.items.filter((t) => t.id !== path.task_id)
      })
    },
    onError: (error, _vars, snapshot) => {
      restore(queryClient, snapshot)
      toastError(error)
    },
  })
  const move = useMutation({
    ...tasksItemMoveMutation(),
    ...shared,
    onMutate: async ({ path, body }) => {
      await queryClient.cancelQueries({
        predicate: (query) => taskQueryKeys.isItemQuery(query.queryKey),
      })
      if (body.list_id !== undefined) return undefined // changing list: wait for the server
      return patchPages(queryClient, (page, params) => {
        const moving = page.items.find((t) => t.id === path.task_id)
        if (!moving || params.sort !== 'manual' || params.only_completed) return page.items
        const rest = page.items.filter((t) => t.id !== path.task_id)
        const at = body.before_task_id ? rest.findIndex((t) => t.id === body.before_task_id) : -1
        rest.splice(at < 0 ? rest.length : at, 0, moving)
        return rest
      })
    },
    onError: (error, _vars, snapshot) => {
      restore(queryClient, snapshot)
      toastError(error)
    },
  })
  const remove = useMutation({ ...tasksItemDeleteMutation(), ...shared })
  const clear = useMutation({ ...tasksItemClearCompletedMutation(), ...shared })
  const createList = useMutation({ ...tasksListCreateMutation(), ...shared })
  const updateList = useMutation({ ...tasksListUpdateMutation(), ...shared })
  const deleteList = useMutation({ ...tasksListDeleteMutation(), ...shared })
  const reorderLists = useMutation({ ...tasksListReorderMutation(), ...shared })
  // `mutateAsync` stays the same function while a mutation runs; the result objects do not.
  const run = {
    create: create.mutateAsync,
    update: update.mutateAsync,
    complete: complete.mutateAsync,
    move: move.mutateAsync,
    remove: remove.mutateAsync,
    clear: clear.mutateAsync,
    createList: createList.mutateAsync,
    updateList: updateList.mutateAsync,
    deleteList: deleteList.mutateAsync,
    reorderLists: reorderLists.mutateAsync,
  }
  const actions = {
    create: (programId: string, body: TaskCreateInputBody) =>
      run.create({ path: { program_id: programId }, body }),
    update: (taskId: string, body: TaskUpdateInputBody) =>
      run.update({ path: { task_id: taskId }, body }),
    /**
     * Checking a task off waits in place for a few seconds before it is saved (`completion.ts`);
     * unchecking it in that time just stops the wait.
     */
    complete: async (taskId: string, completed: boolean) => {
      if (completed) {
        const options = { path: { task_id: taskId }, body: { completed } }
        scheduleCompletion(taskId, (unloading) =>
          unloading
            ? // The page is going away: a plain request that outlives it, then fresh lists if
              // the page comes back.
              tasksItemComplete({ ...options, keepalive: true }).then(() =>
                invalidateTasks(queryClient),
              )
            : run.complete(options),
        )
        return
      }
      if (cancelCompletion(taskId)) return
      await run.complete({ path: { task_id: taskId }, body: { completed } })
    },
    move: (taskId: string, body: { list_id?: string | null; before_task_id?: string | null }) =>
      run.move({ path: { task_id: taskId }, body }),
    remove: (taskId: string) => {
      // A task deleted while it waits to be completed is not completed afterwards.
      cancelCompletion(taskId)
      return run.remove({ path: { task_id: taskId } })
    },
    clearCompleted: (
      programId: string,
      body: { list_id?: string; term_id?: string; course_id?: string },
    ) => run.clear({ path: { program_id: programId }, body }),
    createList: (programId: string, body: { name: string; term_id?: string | null }) =>
      run.createList({ path: { program_id: programId }, body }),
    renameList: (listId: string, name: string) =>
      run.updateList({ path: { list_id: listId }, body: { name } }),
    deleteList: (listId: string, deleteTasks: boolean) =>
      run.deleteList({ path: { list_id: listId }, query: { delete_tasks: deleteTasks } }),
    reorderLists: (programId: string, listIds: string[]) =>
      run.reorderLists({ path: { program_id: programId }, body: { list_ids: listIds } }),
  }
  const pending = create.isPending || clear.isPending || deleteList.isPending || remove.isPending
  return { actions, pending }
}

export type TaskActions = ReturnType<typeof useTaskActions>['actions']
