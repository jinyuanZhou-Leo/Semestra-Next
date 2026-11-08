import { filesEntryDeleteMany, filesEntryMoveMany } from '@semestra/api-client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Target } from './folders'
import { invalidateFiles } from './queries'

/** The ids of `targets`, split the way the API takes them. */
function entryIds(targets: readonly Target[]) {
  return {
    item_ids: targets.flatMap((t) => (t.type === 'item' ? [t.item.id] : [])),
    folder_ids: targets.flatMap((t) => (t.type === 'folder' ? [t.folder.id] : [])),
  }
}

/**
 * Moves files and folders into a folder of the same course (null = its top level), in one
 * request: either all of them move or none do.
 */
export function useMoveTargets() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      courseId,
      targets,
      folderId,
    }: {
      courseId: string
      targets: readonly Target[]
      folderId: string | null
    }) =>
      filesEntryMoveMany({
        path: { course_id: courseId },
        body: { ...entryIds(targets), to_folder_id: folderId },
        throwOnError: true,
      }),
    onSuccess: () => invalidateFiles(queryClient),
  })
}

/** Deletes files and folders (with everything in them) in one request: all or none. */
export function useDeleteTargets() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ courseId, targets }: { courseId: string; targets: readonly Target[] }) =>
      filesEntryDeleteMany({
        path: { course_id: courseId },
        body: entryIds(targets),
        throwOnError: true,
      }),
    onSuccess: () => invalidateFiles(queryClient),
  })
}
