import type { FolderOut, ItemOut } from '@semestra/api-client'
import {
  filesItemDropCopyMutation,
  filesItemKeepCopyMutation,
  filesItemReprocessMutation,
  filesItemUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Download,
  FileSearch,
  FolderInput,
  HardDrive,
  MoreHorizontal,
  Pencil,
  Pin,
  RotateCw,
  Trash2,
} from 'lucide-react'
import { toastError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { contentUrl, invalidateFiles } from '../queries'
import { useHandlers } from './browser'
import { useItemActions } from './ItemActions'
import { copyLabel } from './Origin'

function usePinToggle() {
  const queryClient = useQueryClient()
  return useMutation({
    ...filesItemUpdateMutation(),
    onError: toastError,
    onSuccess: (saved) => invalidateFiles(queryClient, saved.course_id),
  })
}

export function PinButton({ item }: { item: ItemOut }) {
  const toggle = usePinToggle()
  const label = item.pinned ? m.files_unpin() : m.files_pin()
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-pressed={item.pinned}
            disabled={toggle.isPending}
            onClick={() =>
              toggle.mutate({ path: { item_id: item.id }, body: { pinned: !item.pinned } })
            }
          />
        }
      >
        <Pin aria-hidden className={cn(item.pinned && 'fill-current text-primary')} />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function ItemMenu({ item }: { item: ItemOut }) {
  const { act, programId } = useHandlers()
  const actions = useItemActions(item)
  const canReprocess =
    item.kind === 'file' && (item.doc_status === 'ready' || item.doc_status === 'failed')
  const canIndex = item.kind === 'file' && item.doc_status === 'none'
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={m.files_actions({ name: item.display_name })}
                />
              }
            />
          }
        >
          <MoreHorizontal aria-hidden />
        </TooltipTrigger>
        <TooltipContent>{m.files_more_actions()}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        className={
          item.follows_source || (programId && actions.some((a) => a.description))
            ? 'w-72'
            : undefined
        }
      >
        <DropdownMenuItem onClick={() => act({ kind: 'rename', target: { type: 'item', item } })}>
          <Pencil aria-hidden />
          {m.files_rename()}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => act({ kind: 'move', targets: [{ type: 'item', item }] })}>
          <FolderInput aria-hidden />
          {m.files_move_to()}
        </DropdownMenuItem>
        {item.kind === 'file' ? (
          <DropdownMenuItem
            // oxlint-disable-next-line jsx-a11y/anchor-has-content -- the content arrives through `props`
            render={(props) => <a {...props} href={contentUrl(item.id, 'attachment')} download />}
          >
            <Download aria-hidden />
            {m.files_download()}
          </DropdownMenuItem>
        ) : null}
        {item.follows_source ? <CopyItems item={item} source={item.source_name ?? ''} /> : null}
        {canReprocess || canIndex ? <ReprocessItem item={item} /> : null}
        {programId && actions.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            {actions.map((action) => (
              <DropdownMenuItem
                key={action.id}
                onClick={() => void action.run({ programId, item })}
              >
                <action.icon aria-hidden />
                <span className="min-w-0">
                  <span className="block">
                    <action.Label programId={programId} item={item} />
                  </span>
                  {action.description ? (
                    <span className="block text-xs text-muted-foreground">
                      {action.description()}
                    </span>
                  ) : null}
                </span>
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => act({ kind: 'delete', targets: [{ type: 'item', item }] })}
        >
          <Trash2 aria-hidden />
          {m.common_delete()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * A file that follows its source (an LMS file) is read from it when opened, or saved here so it
 * still opens once the source is gone; either way it keeps following. Saving fetches the file in
 * a job the status bar shows, failing there with the reason.
 */
function CopyItems({ item, source }: { item: ItemOut; source: string }) {
  const queryClient = useQueryClient()
  const options = {
    onError: toastError,
    onSuccess: (saved: ItemOut) => invalidateFiles(queryClient, saved.course_id),
  }
  const keep = useMutation({ ...filesItemKeepCopyMutation(), ...options })
  const drop = useMutation({ ...filesItemDropCopyMutation(), ...options })
  const path = { item_id: item.id }
  // Checked: the file is to be kept here (saved, being saved, or not saved and why).
  const state = item.local_copy?.state ?? 'online'
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuCheckboxItem
        checked={state !== 'online'}
        closeOnClick
        onCheckedChange={(saved) => (saved ? keep : drop).mutate({ path })}
      >
        <HardDrive aria-hidden />
        <span className="min-w-0">
          <span className="block">{m.files_save_here()}</span>
          <span className="block text-xs text-muted-foreground">
            {m.files_save_here_hint({ source })}
          </span>
          {state === 'failed' ? (
            <span className="block text-xs text-destructive">{copyLabel(item, source)}</span>
          ) : null}
        </span>
      </DropdownMenuCheckboxItem>
    </>
  )
}

function ReprocessItem({ item }: { item: ItemOut }) {
  const queryClient = useQueryClient()
  // The menu closes on click, so the mutation lives in the item and reports through toasts.
  const reprocess = useMutation({
    ...filesItemReprocessMutation(),
    onError: toastError,
    onSuccess: (saved) => invalidateFiles(queryClient, saved.course_id),
  })
  return (
    <DropdownMenuItem onClick={() => reprocess.mutate({ path: { item_id: item.id } })}>
      {item.doc_status === 'none' ? <FileSearch aria-hidden /> : <RotateCw aria-hidden />}
      {item.doc_status === 'none' ? m.files_index_now() : m.files_reprocess()}
    </DropdownMenuItem>
  )
}

export function FolderMenu({ folder }: { folder: FolderOut }) {
  const { act } = useHandlers()
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={m.files_actions({ name: folder.name })}
                />
              }
            />
          }
        >
          <MoreHorizontal aria-hidden />
        </TooltipTrigger>
        <TooltipContent>{m.files_more_actions()}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => act({ kind: 'rename', target: { type: 'folder', folder } })}
        >
          <Pencil aria-hidden />
          {m.files_rename()}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => act({ kind: 'move', targets: [{ type: 'folder', folder }] })}
        >
          <FolderInput aria-hidden />
          {m.files_move_to()}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => act({ kind: 'delete', targets: [{ type: 'folder', folder }] })}
        >
          <Trash2 aria-hidden />
          {m.common_delete()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
