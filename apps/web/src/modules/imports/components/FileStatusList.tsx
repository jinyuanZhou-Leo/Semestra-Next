import type { SourceRef } from '@semestra/api-client'
import { CircleAlert, CircleCheck, Clock, FileText, X } from 'lucide-react'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from '@/ui/attachment'
import { Progress } from '@/ui/progress'
import { Spinner } from '@/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'

export type FileRow = {
  key: string
  name: string
  /** Bytes; unknown for course files. */
  size?: number
  /** `picked`: chosen, not sent yet. */
  status: 'picked' | 'pending' | 'waiting' | 'uploading' | 'extracting' | 'done' | 'failed'
  /** Bytes sent so far, while uploading. */
  loaded?: number
  onRemove?: () => void
}

/** A session's files as rows; `sizes` are the picked files' sizes, in the same order. */
export function sessionRows(refs: SourceRef[], sizes: readonly number[] = []): FileRow[] {
  return refs.map((ref, index) => ({
    key: ref.upload_id ?? ref.file_item_id ?? String(index),
    name: ref.filename ?? m.imports_file(),
    size: ref.upload_id ? sizes[index] : undefined,
    status: ref.status ?? 'pending',
  }))
}

const STATUS_LABEL = {
  picked: () => null,
  pending: () => m.imports_file_pending(),
  waiting: () => m.imports_file_waiting(),
  uploading: () => m.imports_file_uploading(),
  extracting: () => m.imports_file_extracting(),
  done: () => m.imports_file_done(),
  failed: () => m.imports_file_failed(),
}

const STATE = {
  picked: 'idle',
  pending: 'done',
  waiting: 'processing',
  uploading: 'uploading',
  extracting: 'processing',
  done: 'done',
  failed: 'error',
} as const

function RowIcon({ status }: { status: FileRow['status'] }) {
  if (status === 'uploading' || status === 'extracting') return <Spinner />
  if (status === 'done') return <CircleCheck className="text-success" />
  if (status === 'failed') return <CircleAlert />
  if (status === 'waiting') return <Clock />
  return <FileText />
}

/**
 * The files of an import and how far each one is: picked, uploading (with its own bar), then
 * reading. Rows keep one height in every state, so the list does not move as they change.
 */
export function FileStatusList({ rows }: { rows: FileRow[] }) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => {
        const uploading = row.status === 'uploading' && row.size != null
        const percent = uploading && row.size ? Math.round(((row.loaded ?? 0) / row.size) * 100) : 0
        const detail = uploading
          ? m.imports_upload_progress({
              loaded: formatBytes(row.loaded ?? 0),
              total: formatBytes(row.size ?? 0),
              percent,
            })
          : [row.size != null ? formatBytes(row.size) : null, STATUS_LABEL[row.status]()]
              .filter(Boolean)
              .join(' · ')
        return (
          <Attachment key={row.key} state={STATE[row.status]} className="w-full max-w-none">
            <AttachmentMedia>
              <RowIcon status={row.status} />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle className="font-normal">{row.name}</AttachmentTitle>
              <AttachmentDescription>{detail}</AttachmentDescription>
              {/* The bar's line is kept while not uploading, so a row does not change height. */}
              <Progress
                value={uploading ? percent : null}
                aria-label={row.name}
                aria-hidden={!uploading}
                className={cn(
                  'pt-1.5 [&_[data-slot=progress-track]]:h-1',
                  !uploading && 'invisible',
                )}
              />
            </AttachmentContent>
            {row.onRemove ? (
              <AttachmentActions>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <AttachmentAction
                        aria-label={m.imports_remove_file({ name: row.name })}
                        onClick={row.onRemove}
                      />
                    }
                  >
                    <X aria-hidden />
                  </TooltipTrigger>
                  <TooltipContent>{m.imports_remove_file({ name: row.name })}</TooltipContent>
                </Tooltip>
              </AttachmentActions>
            ) : null}
          </Attachment>
        )
      })}
    </div>
  )
}
