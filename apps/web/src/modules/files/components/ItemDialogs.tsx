import type { FolderOut, ItemOut } from '@semestra/api-client'
import {
  filesFolderCreateMutation,
  filesFolderDeleteMutation,
  filesFolderUpdateMutation,
  filesItemDeleteMutation,
  filesItemUpdateMutation,
  filesLinkCreateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { errorMessage } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import { NativeSelect, NativeSelectOption } from '@/ui/native-select'
import { invalidateFiles } from '../queries'

export type Target = { type: 'item'; item: ItemOut } | { type: 'folder'; folder: FolderOut }

/** The dialog the file page has open, if any. */
export type ItemAction =
  | { kind: 'rename'; target: Target }
  | { kind: 'move'; item: ItemOut }
  | { kind: 'delete'; target: Target }
  | { kind: 'new-folder'; parentId: string | null }
  | { kind: 'new-link'; folderId: string | null }

/** "Week 1 / Slides" for each folder, in tree order, for the move picker. */
export function folderPaths(folders: readonly FolderOut[]): { id: string; path: string }[] {
  const out: { id: string; path: string }[] = []
  const visit = (parentId: string | null, prefix: string) => {
    for (const folder of folders
      .filter((f) => f.parent_id === parentId)
      .toSorted((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
      const path = prefix ? `${prefix} / ${folder.name}` : folder.name
      out.push({ id: folder.id, path })
      visit(folder.id, path)
    }
  }
  visit(null, '')
  return out
}

function useFilesMutation<T>(options: T) {
  const queryClient = useQueryClient()
  return { ...options, onSuccess: () => invalidateFiles(queryClient) }
}

function NameDialog({
  open,
  title,
  label,
  initial,
  submitLabel,
  pending,
  error,
  onSubmit,
  onClose,
  extraField,
}: {
  open: boolean
  title: string
  label: string
  initial: string
  submitLabel: string
  pending: boolean
  error: string | null
  onSubmit: (value: string, extra: string) => void
  onClose: () => void
  extraField?: { label: string; placeholder?: string; required: boolean }
}) {
  const id = useId()
  const [value, setValue] = useState(initial)
  const [extra, setExtra] = useState('')
  const [touched, setTouched] = useState(false)
  const nameMissing = !extraField?.required && value.trim() === ''
  const extraMissing = Boolean(extraField?.required) && extra.trim() === ''
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (nameMissing || extraMissing) return
    onSubmit(value.trim(), extra.trim())
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={submit}>
          <FieldGroup className="gap-4">
            {extraField ? (
              <Field data-invalid={(touched && extraMissing) || undefined}>
                <FieldLabel htmlFor={`${id}-extra`}>{extraField.label}</FieldLabel>
                <Input
                  id={`${id}-extra`}
                  type="url"
                  inputMode="url"
                  placeholder={extraField.placeholder}
                  aria-invalid={(touched && extraMissing) || undefined}
                  value={extra}
                  onChange={(event) => setExtra(event.target.value)}
                />
                {touched && extraMissing ? <FieldError>{m.files_required()}</FieldError> : null}
              </Field>
            ) : null}
            <Field data-invalid={(touched && nameMissing) || undefined}>
              <FieldLabel htmlFor={`${id}-name`}>{label}</FieldLabel>
              <Input
                id={`${id}-name`}
                aria-invalid={(touched && nameMissing) || undefined}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
              {touched && nameMissing ? <FieldError>{m.files_required()}</FieldError> : null}
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? m.common_saving() : submitLabel}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function MoveDialog({
  item,
  folders,
  onClose,
}: {
  item: ItemOut
  folders: readonly FolderOut[]
  onClose: () => void
}) {
  const id = useId()
  const [folderId, setFolderId] = useState(item.folder_id ?? '')
  const update = useMutation({ ...useFilesMutation(filesItemUpdateMutation()) })
  return (
    <Dialog open onOpenChange={(next) => !next && !update.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.files_move_title({ name: item.display_name })}</DialogTitle>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            update.mutate(
              { path: { item_id: item.id }, body: { folder_id: folderId || null } },
              { onSuccess: onClose },
            )
          }}
        >
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor={`${id}-folder`}>{m.files_folder()}</FieldLabel>
              <NativeSelect
                id={`${id}-folder`}
                value={folderId}
                onChange={(event) => setFolderId(event.target.value)}
              >
                <NativeSelectOption value="">{m.files_all_files()}</NativeSelectOption>
                {folderPaths(folders).map((f) => (
                  <NativeSelectOption key={f.id} value={f.id}>
                    {f.path}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            {update.error ? <FieldError>{errorMessage(update.error)}</FieldError> : null}
            <DialogFooter>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? m.common_saving() : m.files_move()}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Files in a folder and all its subfolders. */
export function filesInside(
  folderId: string,
  folders: readonly FolderOut[],
  items: readonly ItemOut[],
): number {
  const ids = new Set([folderId])
  let grew = true
  while (grew) {
    grew = false
    for (const f of folders) {
      if (f.parent_id && ids.has(f.parent_id) && !ids.has(f.id)) {
        ids.add(f.id)
        grew = true
      }
    }
  }
  return items.filter((i) => i.folder_id && ids.has(i.folder_id)).length
}

function DeleteDialog({
  target,
  fileCount,
  onClose,
}: {
  target: Target
  fileCount: number
  onClose: () => void
}) {
  const removeItem = useMutation({ ...useFilesMutation(filesItemDeleteMutation()) })
  const removeFolder = useMutation({ ...useFilesMutation(filesFolderDeleteMutation()) })
  const pending = removeItem.isPending || removeFolder.isPending
  const error = removeItem.error ?? removeFolder.error
  const name = target.type === 'item' ? target.item.display_name : target.folder.name
  const description =
    target.type === 'item'
      ? m.files_delete_item_description()
      : fileCount > 0
        ? m.files_delete_folder_with_files_description({ count: fileCount })
        : m.files_delete_folder_description()
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={m.files_delete_title({ name })}
      description={description}
      confirmLabel={m.common_delete()}
      pending={pending}
      extra={error ? <FieldError>{errorMessage(error)}</FieldError> : null}
      onConfirm={() =>
        target.type === 'item'
          ? removeItem.mutate({ path: { item_id: target.item.id } }, { onSuccess: onClose })
          : removeFolder.mutate(
              // Subfolders without files count as empty too, so delete the whole branch.
              { path: { folder_id: target.folder.id }, query: { recursive: true } },
              { onSuccess: onClose },
            )
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
}: {
  courseId: string
  folders: readonly FolderOut[]
  items: readonly ItemOut[]
  action: ItemAction | null
  onClose: () => void
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
    return <MoveDialog item={action.item} folders={folders} onClose={close} />
  if (action.kind === 'delete') {
    const { target } = action
    const fileCount = target.type === 'folder' ? filesInside(target.folder.id, folders, items) : 0
    return <DeleteDialog target={target} fileCount={fileCount} onClose={close} />
  }

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
