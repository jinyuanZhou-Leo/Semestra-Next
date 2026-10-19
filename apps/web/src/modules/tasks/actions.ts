import type { TaskCreateInputBody, TaskUpdateInputBody } from '@semestra/api-client'
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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toastError } from '@/lib/errors'
import { invalidateTasks } from './queries'

/** Every change a task view can make, each refreshing the task queries and toasting failures. */
export function useTaskActions() {
  const queryClient = useQueryClient()
  const shared = { onError: toastError, onSettled: () => invalidateTasks(queryClient) }
  const create = useMutation({ ...tasksItemCreateMutation(), ...shared })
  const update = useMutation({ ...tasksItemUpdateMutation(), ...shared })
  const complete = useMutation({ ...tasksItemCompleteMutation(), ...shared })
  const move = useMutation({ ...tasksItemMoveMutation(), ...shared })
  const remove = useMutation({ ...tasksItemDeleteMutation(), ...shared })
  const clear = useMutation({ ...tasksItemClearCompletedMutation(), ...shared })
  const createList = useMutation({ ...tasksListCreateMutation(), ...shared })
  const updateList = useMutation({ ...tasksListUpdateMutation(), ...shared })
  const deleteList = useMutation({ ...tasksListDeleteMutation(), ...shared })
  const reorderLists = useMutation({ ...tasksListReorderMutation(), ...shared })
  return {
    create: (programId: string, body: TaskCreateInputBody) =>
      create.mutateAsync({ path: { program_id: programId }, body }),
    update: (taskId: string, body: TaskUpdateInputBody) =>
      update.mutateAsync({ path: { task_id: taskId }, body }),
    complete: (taskId: string, completed: boolean) =>
      complete.mutateAsync({ path: { task_id: taskId }, body: { completed } }),
    move: (taskId: string, body: { list_id?: string | null; before_task_id?: string | null }) =>
      move.mutateAsync({ path: { task_id: taskId }, body }),
    remove: (taskId: string) => remove.mutateAsync({ path: { task_id: taskId } }),
    clearCompleted: (
      programId: string,
      body: { list_id?: string; term_id?: string; course_id?: string },
    ) => clear.mutateAsync({ path: { program_id: programId }, body }),
    createList: (programId: string, body: { name: string; term_id?: string | null }) =>
      createList.mutateAsync({ path: { program_id: programId }, body }),
    renameList: (listId: string, name: string) =>
      updateList.mutateAsync({ path: { list_id: listId }, body: { name } }),
    deleteList: (listId: string, deleteTasks: boolean) =>
      deleteList.mutateAsync({ path: { list_id: listId }, query: { delete_tasks: deleteTasks } }),
    reorderLists: (programId: string, listIds: string[]) =>
      reorderLists.mutateAsync({ path: { program_id: programId }, body: { list_ids: listIds } }),
    pending: create.isPending || clear.isPending || deleteList.isPending || remove.isPending,
  }
}

export type TaskActions = ReturnType<typeof useTaskActions>
