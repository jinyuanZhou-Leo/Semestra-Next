import type { ItemOut } from '@semestra/api-client'
import { filesItemReprocessMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, RotateCw, ScanText } from 'lucide-react'
import { JobProgress } from '@/components/JobProgress'
import { errorMessage, toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Spinner } from '@/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { invalidateFiles } from '../queries'

/**
 * Where a file is in the document pipeline (M07 §6.1). Ready and unsupported files show nothing:
 * the column only speaks up while processing, on failure, or when scanned pages were skipped.
 */
export function StatusCell({ item }: { item: ItemOut }) {
  const queryClient = useQueryClient()
  const retry = useMutation({
    ...filesItemReprocessMutation(),
    onError: toastError,
    onSuccess: () => invalidateFiles(queryClient),
  })

  if (item.doc_status === 'pending' || item.doc_status === 'processing') {
    return item.job_id ? (
      <JobProgress jobId={item.job_id} variant="ring" />
    ) : (
      <Spinner aria-label={m.files_status_processing()} />
    )
  }
  if (item.doc_status === 'failed') {
    const reason = errorMessage({
      error: { code: item.doc_error_code ?? 'files.parse_failed', params: {} },
    })
    return (
      <span className="inline-flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex text-destructive" />}>
            <CircleAlert aria-hidden className="size-4" />
            <span className="sr-only">{reason}</span>
          </TooltipTrigger>
          <TooltipContent>{reason}</TooltipContent>
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
  if (item.doc_status === 'ready' && item.ocr_skipped_pages > 0) {
    const text = m.files_ocr_skipped({ count: item.ocr_skipped_pages })
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
  return null
}
