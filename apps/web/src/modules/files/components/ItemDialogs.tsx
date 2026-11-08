import type { FolderOut, ItemOut } from '@semestra/api-client'
import {
  filesFolderCreateMutation,
  filesFolderUpdateMutation,
  filesItemUpdateMutation,
  filesLinkCreateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { errorMessage } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { FieldError } from '@/ui/field'
import { useDeleteTargets } from '../actions'
import { type Target, filesInside, targetName } from '../folders'
import { invalidateFiles } from '../queries'
import { MoveDialog } from './MoveDialog'
import { NameDialog } from './NameDialog'

/** The dialog the file page has open, if any. */
export type ItemAction =
  | { kind: 'rename'; target: Target }
  | { kind: 'move'; targets: Target[] }
  | { kind: 'delete'; targets: Target[] }
  | { kind: 'new-folder'; parentId: string | null }
  | { kind: 'new-link'; folderId: string | null }

function useFilesMutation<T>(options: T) {
  const queryClient = useQueryClient()
  return { ...options, onSuccess: () => invalidateFiles(queryClient) }
}

function DeleteDialog({
  targets,
  folders,
  items,
  onClose,
  onDone,
}: {
  targets: Target[]
  folders: readonly FolderOut[]
  items: readonly ItemOut[]
  onClose: () => void
  onDone?: () => void
}) {
  const remove = useDeleteTargets()
  const only = targets.length === 1 ? targets[0] : undefined
  const fileCount = targets.reduce(
    (sum, t) => sum + (t.type === 'folder' ? filesInside(t.folder.id, folders, items) : 1),
    0,
  )
  const description = !only
    ? m.files_delete_many_description({ count: fileCount })
    : only.type === 'item'
      ? only.item.kind === 'link'
        ? m.files_delete_link_description()
        : m.files_delete_item_description()
      : fileCount > 0
        ? m.files_delete_folder_with_files_description({ count: fileCount })
        : m.files_delete_folder_description()
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={
        only
          ? m.files_delete_title({ name: targetName(only) })
          : m.files_delete_many_title({ count: targets.length })
      }
      description={description}
      confirmLabel={m.common_delete()}
      pending={remove.isPending}
      extra={remove.error ? <FieldError>{errorMessage(remove.error)}</FieldError> : null}
      onConfirm={() =>
        remove.mutate(targets, {
          onSuccess: () => {
            onDone?.()
            onClose()
          },
        })
      }
    />
  )
}

/** Rename, move, delete, new folder and new link for the file page. */
export function ItemDialogs({
  courseId,
  folders,
  items,
  action,
  onClose,
  onDone,
}: {
  courseId: string
  folders: readonly FolderOut[]
  items: readonly ItemOut[]
  action: ItemAction | null
  onClose: () => void
  /** After a move or delete went through (the page clears its selection). */
  onDone?: () => void
}) {
  const updateItem = useMutation({ ...useFilesMutation(filesItemUpdateMutation()) })
  const updateFolder = useMutation({ ...useFilesMutation(filesFolderUpdateMutation()) })
  const createFolder = useMutation({ ...useFilesMutation(filesFolderCreateMutation()) })
  const createLink = useMutation({ ...useFilesMutation(filesLinkCreateMutation()) })
  const close = () => {
    for (const mutation of [updateItem, updateFolder, createFolder, createLink]) mutation.reset()
    onClose()
  }
  if (!action) return null

  if (action.kind === 'move')
    return (
      <MoveDialog
        courseId={courseId}
        targets={action.targets}
        folders={folders}
        onClose={close}
        onDone={onDone}
      />
    )
  if (action.kind === 'delete')
    return (
      <DeleteDialog
        targets={action.targets}
        folders={folders}
        items={items}
        onClose={close}
        onDone={onDone}
      />
    )

  if (action.kind === 'rename') {
    const { target } = action
    const mutation = target.type === 'item' ? updateItem : updateFolder
    return (
      <NameDialog
        open
        title={m.files_rename()}
        label={m.files_name()}
        initial={target.type === 'item' ? target.item.display_name : target.folder.name}
        submitLabel={m.common_save()}
        pending={mutation.isPending}
        error={mutation.error ? errorMessage(mutation.error) : null}
        onClose={close}
        onSubmit={(name) =>
          target.type === 'item'
            ? updateItem.mutate(
                { path: { item_id: target.item.id }, body: { display_name: name } },
                { onSuccess: close },
              )
            : updateFolder.mutate(
                { path: { folder_id: target.folder.id }, body: { name } },
                { onSuccess: close },
              )
        }
      />
    )
  }

  if (action.kind === 'new-folder') {
    return (
      <NameDialog
        open
        title={m.files_new_folder()}
        label={m.files_name()}
        initial=""
        submitLabel={m.files_create()}
        pending={createFolder.isPending}
        error={createFolder.error ? errorMessage(createFolder.error) : null}
        onClose={close}
        onSubmit={(name) =>
          createFolder.mutate(
            { path: { course_id: courseId }, body: { name, parent_id: action.parentId } },
            { onSuccess: close },
          )
        }
      />
    )
  }

  return (
    <NameDialog
      open
      title={m.files_add_link()}
      label={m.files_link_name()}
      initial=""
      submitLabel={m.files_add_link()}
      extraField={{ label: m.files_link_url(), placeholder: 'https://', required: true }}
      pending={createLink.isPending}
      error={createLink.error ? errorMessage(createLink.error) : null}
      onClose={close}
      onSubmit={(name, url) =>
        createLink.mutate(
          {
            path: { course_id: courseId },
            body: { url, display_name: name || null, folder_id: action.folderId },
          },
          { onSuccess: close },
        )
      }
    />
  )
}
