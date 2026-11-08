import {
  filesFolderDelete,
  filesFolderUpdate,
  filesItemDelete,
  filesItemUpdate,
} from '@semestra/api-client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Target } from './folders'
import { invalidateFiles } from './queries'

/** Moves files and folders into a folder of the same course (null = its top level). */
export function useMoveTargets() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ targets, folderId }: { targets: Target[]; folderId: string | null }) => {
      await Promise.all(
        targets.map((t) =>
          t.type === 'item'
            ? filesItemUpdate({
                path: { item_id: t.item.id },
                body: { folder_id: folderId },
                throwOnError: true,
              })
            : filesFolderUpdate({
                path: { folder_id: t.folder.id },
                body: { parent_id: folderId },
                throwOnError: true,
              }),
        ),
      )
    },
    // Some may have moved before one failed.
    onSettled: () => invalidateFiles(queryClient),
  })
}

/** Deletes files and folders; a folder goes with everything in it. */
export function useDeleteTargets() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (targets: Target[]) => {
      await Promise.all(
        targets.map((t) =>
          t.type === 'item'
            ? filesItemDelete({ path: { item_id: t.item.id }, throwOnError: true })
            : filesFolderDelete({
                path: { folder_id: t.folder.id },
                query: { recursive: true },
                throwOnError: true,
              }),
        ),
      )
    },
    onSettled: () => invalidateFiles(queryClient),
  })
}
