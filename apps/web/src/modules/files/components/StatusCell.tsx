import type { ItemOut } from '@semestra/api-client'
import { filesItemReprocessMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, FileSearch, RotateCw, ScanText } from 'lucide-react'
import { JobProgress } from '@/components/JobProgress'
import { useAiStatus } from '@/hooks/use-ai-status'
import { errorMessage, toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Spinner } from '@/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { invalidateFiles } from '../queries'

/**
 * Where a file is in the document pipeline (M07 §6.1). Ready and unsupported files show nothing:
 * the column only speaks up while processing, on failure, when scanned pages were skipped, or
 * for a file that was never indexed.
 * In the list a processing file shows its step (with page or batch counts) over a thin bar, and a
 * failed one says why next to the retry button; grid tiles have room only for icons, with the
 * text in their tooltips.
 */
export function StatusCell({ item, compact = false }: { item: ItemOut; compact?: boolean }) {
  const queryClient = useQueryClient()
  const retry = useMutation({
    ...filesItemReprocessMutation(),
    onError: toastError,
    onSuccess: () => invalidateFiles(queryClient),
  })

  if (item.doc_status === 'pending' || item.doc_status === 'processing') {
    return item.job_id ? (
      <JobProgress
        jobId={item.job_id}
        variant={compact ? 'ring' : 'bar'}
        className={compact ? undefined : 'w-full'}
      />
    ) : (
      <Spinner aria-label={m.files_status_processing()} />
    )
  }
  if (item.doc_status === 'failed') {
    const reason = errorMessage({
      error: { code: item.doc_error_code ?? 'files.parse_failed', params: {} },
    })
    return (
      <span className="flex min-w-0 items-center gap-1">
        <Tooltip>
          <TooltipTrigger
            render={<span className="flex min-w-0 items-center gap-1.5 text-destructive" />}
          >
            <CircleAlert aria-hidden className="size-4 shrink-0" />
            <span
              className={
                compact ? 'sr-only' : 'line-clamp-2 text-xs leading-tight whitespace-normal'
              }
            >
              {reason}
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">{reason}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={m.files_retry_processing()}
                disabled={retry.isPending}
                onClick={() => retry.mutate({ path: { item_id: item.id } })}
              />
            }
          >
            <RotateCw aria-hidden />
          </TooltipTrigger>
          <TooltipContent>{m.files_retry_processing()}</TooltipContent>
        </Tooltip>
      </span>
    )
  }
  if (item.kind === 'file' && item.doc_status === 'none') {
    // Added while auto-indexing was off (the `files` setting): indexed only when asked.
    const index = () => retry.mutate({ path: { item_id: item.id } })
    return compact ? (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={m.files_index_now()}
              disabled={retry.isPending}
              onClick={index}
            />
          }
        >
          <FileSearch aria-hidden />
        </TooltipTrigger>
        <TooltipContent>{m.files_index_now()}</TooltipContent>
      </Tooltip>
    ) : (
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-xs text-muted-foreground">
          {m.files_status_not_indexed()}
        </span>
        <Button variant="outline" size="xs" disabled={retry.isPending} onClick={index}>
          {m.files_index_now()}
        </Button>
      </span>
    )
  }
  if (item.doc_status === 'ready' && item.ocr_skipped_pages > 0) {
    return <OcrSkipped count={item.ocr_skipped_pages} />
  }
  return null
}

/**
 * Scanned pages that were not read. With this server's own OCR the usual cause is that its model
 * could not be downloaded, not a missing model choice, so the hint says so.
 */
function OcrSkipped({ count }: { count: number }) {
  const { status } = useAiStatus('ocr')
  const text =
    status?.source === 'local'
      ? m.files_ocr_skipped_local({ count })
      : m.files_ocr_skipped({ count })
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex text-muted-foreground" />}>
        <ScanText aria-hidden className="size-4" />
        <span className="sr-only">{text}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{text}</TooltipContent>
    </Tooltip>
  )
}
