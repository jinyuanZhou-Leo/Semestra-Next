import type { FolderOut, ItemOut } from '@semestra/api-client'
import { Cloud, CloudAlert, FolderSync, HardDrive, HardDriveDownload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Spinner } from '@/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'

/** A folder made for its place on a source (an LMS's folder or module), named after it. */
export function FolderOrigin({ folder }: { folder: FolderOut }) {
  if (!folder.source_name) return null
  const label = m.files_origin_folder({ provider: folder.source_name })
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
          <FolderSync aria-hidden className="size-3.5" />
          <span className="sr-only">{label}</span>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <span className="truncate">{folder.source_name}</span>
    </span>
  )
}

/** Why a copy the user wants here is not (the current version of) it, in a few words. */
function copyReason(code: string | null | undefined, source: string): string {
  if (code === 'files.too_large') return m.files_copy_reason_too_large()
  if (code === 'common.quota_exceeded') return m.files_copy_reason_quota()
  if (code === 'lms.unreachable' || code === 'files.source_unreachable')
    return m.files_copy_reason_unreachable({ source })
  return m.files_copy_reason_unavailable({ source })
}

/** Where a file that follows its source is kept, as the status column and its menu say it. */
export function copyLabel(item: ItemOut, source: string): string {
  const copy = item.local_copy
  switch (copy?.state) {
    case 'saving':
      return m.files_origin_saving()
    case 'saved':
      return m.files_origin_stored()
    case 'outdated':
      return copy.error_code
        ? m.files_origin_outdated_reason({ reason: copyReason(copy.error_code, source) })
        : m.files_origin_outdated()
    case 'failed':
      return m.files_origin_failed({ reason: copyReason(copy.error_code, source) })
    default:
      return m.files_origin_online({ source })
  }
}

const COPY_ICONS = {
  online: Cloud,
  saved: HardDrive,
  outdated: HardDriveDownload,
  failed: CloudAlert,
} as const

/**
 * Where a file that follows its source is kept: read from it, being saved, saved here (or an
 * older version of it), or not saved and why. The user's own files show nothing.
 */
export function Origin({ item }: { item: ItemOut }) {
  if (!item.follows_source) return null
  const source = item.source_name ?? ''
  const state = item.local_copy?.state ?? 'online'
  const kept = copyLabel(item, source)
  const Icon = state === 'saving' ? null : COPY_ICONS[state]
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
          {Icon ? (
            <Icon
              aria-hidden
              className={cn('size-3.5', state === 'failed' && 'text-destructive')}
            />
          ) : (
            <Spinner aria-hidden className="size-3.5" />
          )}
          <span className="sr-only">{kept}</span>
        </TooltipTrigger>
        <TooltipContent>{kept}</TooltipContent>
      </Tooltip>
      <span className="truncate">{source}</span>
    </span>
  )
}
