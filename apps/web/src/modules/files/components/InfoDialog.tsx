import type { FolderOut } from '@semestra/api-client'
import { Folder } from 'lucide-react'
import { SettingRow, SettingsGroup } from '@/app/settings/rows'
import { formatBytes, formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog'
import { type Target, folderTree, pathTo, targetName } from '../folders'
import { fileKindName } from '../kinds'
import { FileIcon } from './FileIcon'

/** Values wrap inside their row, so a long path or address never widens the dialog. */
const VALUE = 'min-w-0 text-right break-words'

/**
 * A file's, link's or folder's properties, read-only: the "属性" entry of its menu. What the file
 * list already shows (where it is read from, whether its text has been read) stays there.
 */
export function InfoDialog({
  target,
  folders,
  open,
  onOpenChangeComplete,
  onClose,
}: {
  target: Target
  folders: readonly FolderOut[]
  open: boolean
  onOpenChangeComplete: (open: boolean) => void
  onClose: () => void
}) {
  const parentId = target.type === 'item' ? target.item.folder_id : target.folder.parent_id
  const trail = pathTo(parentId, folderTree(folders)).map((f) => f.name)
  const item = target.type === 'item' ? target.item : null
  const created = target.type === 'item' ? target.item.created_at : target.folder.created_at
  const modified = target.type === 'item' ? target.item.modified_at : target.folder.updated_at
  const kind = !item
    ? m.files_info_folder()
    : item.kind === 'link'
      ? m.files_info_link()
      : fileKindName({ name: item.original_name ?? item.display_name, mime_type: item.mime_type })
  const subtitle = [kind, item?.kind === 'file' ? formatBytes(item.size_bytes) : null]
    .filter(Boolean)
    .join(' · ')
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      onOpenChangeComplete={onOpenChangeComplete}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{m.files_info_title()}</DialogTitle>
          <DialogDescription className="sr-only">{targetName(target)}</DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 flex-col items-center gap-3 py-2 text-center">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            {item ? (
              <FileIcon item={item} aria-hidden className="size-8" />
            ) : (
              <Folder aria-hidden className="size-8" />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-lg leading-snug font-semibold break-words">{targetName(target)}</p>
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <SettingsGroup>
          {[
            item?.kind === 'link' ? (
              <SettingRow key="url" label={m.files_info_address()}>
                <span className={VALUE}>{item.url}</span>
              </SettingRow>
            ) : null,
            item?.kind === 'file' &&
            item.original_name &&
            item.original_name !== item.display_name ? (
              <SettingRow key="original" label={m.files_info_original_name()}>
                <span className={VALUE}>{item.original_name}</span>
              </SettingRow>
            ) : null,
            target.type === 'folder' ? (
              <SettingRow key="count" label={m.files_info_items()}>
                {target.folder.item_count}
              </SettingRow>
            ) : null,
            <SettingRow key="location" label={m.files_info_location()}>
              <span className={VALUE}>
                {trail.length > 0 ? trail.join(' › ') : m.files_all_files()}
              </span>
            </SettingRow>,
            <SettingRow key="created" label={m.files_info_created()}>
              {formatDateTime(created)}
            </SettingRow>,
            <SettingRow key="modified" label={m.files_modified()}>
              {formatDateTime(modified)}
            </SettingRow>,
          ]}
        </SettingsGroup>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{m.common_close()}</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
