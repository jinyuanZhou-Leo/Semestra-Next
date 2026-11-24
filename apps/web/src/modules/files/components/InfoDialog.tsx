import type { FolderOut, ItemOut } from '@semestra/api-client'
import type { ReactNode } from 'react'
import { SettingsGroup } from '@/app/settings/rows'
import { errorMessage } from '@/lib/errors'
import { formatBytes, formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Item, ItemActions, ItemContent } from '@/ui/item'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog'
import { folderTree, pathTo } from '../folders'
import { fileKindName } from '../kinds'
import { FileIcon } from './FileIcon'
import { copyLabel } from './Origin'

/** A property: its name quiet on the left, its value as the content on the right. */
function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Item>
      <ItemContent className="shrink-0 basis-auto text-sm text-muted-foreground">
        {label}
      </ItemContent>
      <ItemActions className="min-w-0 text-right text-sm font-medium break-words">
        {children}
      </ItemActions>
    </Item>
  )
}

function Value({ children }: { children: ReactNode }) {
  return <span className="min-w-0">{children}</span>
}

/** Where a file is in the document pipeline, as one line. */
function textStatus(item: ItemOut): string {
  switch (item.doc_status) {
    case 'pending':
    case 'processing':
      return m.files_status_processing()
    case 'failed':
      return errorMessage({
        error: { code: item.doc_error_code ?? 'files.parse_failed', params: {} },
      })
    case 'unsupported':
      return m.files_info_text_unsupported()
    case 'none':
      return m.files_status_not_indexed()
    default:
      return item.ocr_skipped_pages > 0
        ? m.files_info_text_ready_skipped({ count: item.ocr_skipped_pages })
        : m.files_info_text_ready()
  }
}

/** A file's or link's properties, read-only: the "属性" entry of its menu. */
export function InfoDialog({
  item,
  folders,
  open,
  onOpenChangeComplete,
  onClose,
}: {
  item: ItemOut
  folders: readonly FolderOut[]
  open: boolean
  onOpenChangeComplete: (open: boolean) => void
  onClose: () => void
}) {
  const trail = pathTo(item.folder_id, folderTree(folders)).map((f) => f.name)
  const kind =
    item.kind === 'link'
      ? m.files_info_link()
      : fileKindName({ name: item.original_name ?? item.display_name, mime_type: item.mime_type })
  const source = item.follows_source ? (item.source_name ?? '') : null
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      onOpenChangeComplete={onOpenChangeComplete}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{m.files_info_title()}</DialogTitle>
          <DialogDescription className="sr-only">{item.display_name}</DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 flex-col items-center gap-3 py-2 text-center">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <FileIcon item={item} aria-hidden className="size-8" />
          </span>
          <div className="min-w-0">
            <p className="text-lg leading-snug font-semibold break-words">{item.display_name}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {[kind, item.kind === 'file' ? formatBytes(item.size_bytes) : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </div>
        <SettingsGroup>
          {item.kind === 'file'
            ? [
                item.original_name && item.original_name !== item.display_name ? (
                  <SettingRow key="original" label={m.files_info_original_name()}>
                    <Value>{item.original_name}</Value>
                  </SettingRow>
                ) : null,
              ]
            : [
                <SettingRow key="url" label={m.files_info_address()}>
                  <Value>{item.url}</Value>
                </SettingRow>,
              ]}
          <SettingRow label={m.files_info_location()}>
            <Value>{trail.length > 0 ? trail.join(' › ') : m.files_all_files()}</Value>
          </SettingRow>
          <SettingRow label={m.files_info_created()}>
            <Value>{formatDateTime(item.created_at)}</Value>
          </SettingRow>
          <SettingRow label={m.files_modified()}>
            <Value>{formatDateTime(item.modified_at)}</Value>
          </SettingRow>
        </SettingsGroup>
        {source !== null || item.kind === 'file' ? (
          <SettingsGroup>
            {source !== null
              ? [
                  <SettingRow key="source" label={m.files_info_source()}>
                    <Value>{source}</Value>
                  </SettingRow>,
                  <SettingRow key="kept" label={m.files_info_kept()}>
                    <Value>{copyLabel(item, source)}</Value>
                  </SettingRow>,
                ]
              : null}
            {item.kind === 'file' ? (
              <SettingRow label={m.files_info_text()}>
                <Value>{textStatus(item)}</Value>
              </SettingRow>
            ) : null}
          </SettingsGroup>
        ) : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{m.common_close()}</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
