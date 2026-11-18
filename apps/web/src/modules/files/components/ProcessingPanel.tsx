import type { ProcessingFile } from '@semestra/api-client'
import { filesItemReprocess } from '@semestra/api-client'
import {
  filesProcessingCancelAllMutation,
  filesProcessingListQueryKey,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleStop, RotateCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import {
  PanelFold,
  PanelHeading,
  PanelIconAction,
  PanelMoreList,
  PanelRow,
} from '@/components/StatusPanel'
import { useJob } from '@/hooks/use-job'
import { useNow } from '@/hooks/use-now'
import { errorMessage, toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { ItemGroup } from '@/ui/item'
import { PopoverDescription, PopoverHeader, PopoverTitle } from '@/ui/popover'
import { Progress } from '@/ui/progress'
import { Spinner } from '@/ui/spinner'
import { fileIcon } from '../kinds'
import { filePath } from '../location'
import {
  isActive,
  processingOptions,
  setPanelOpen,
  showFailures,
  shownFiles,
  useSeenFailures,
} from '../processing-line'

/**
 * The panel of the "Processing files" line (M07 §3.1): each file being read, waiting, or that
 * could not be read, with its course and state. A row opens the file; on hover it can be stopped
 * (or read again). "Stop all" stops the round, after a confirmation.
 */
export default function ProcessingPanel({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const list = useQuery(processingOptions()).data
  const [seen] = useSeenFailures()
  const [stopping, setStopping] = useState(false)
  const [retrying, setRetrying] = useState<readonly string[]>([])
  const now = useNow(1000)
  const { active, failed, done } = shownFiles(list, seen, now, true)

  // While it is open, the line keeps what it showed; the failures it lists count as seen once it
  // closes (not on open: they would vanish while the user reads them).
  const failedIds = failed.map((file) => file.job.id).join(' ')
  useEffect(() => {
    setPanelOpen(true)
    return () => setPanelOpen(false)
  }, [])
  useEffect(() => showFailures(failedIds ? failedIds.split(' ') : []), [failedIds])

  const refresh = () => queryClient.invalidateQueries({ queryKey: filesProcessingListQueryKey() })
  const stopAll = useMutation({
    ...filesProcessingCancelAllMutation(),
    onSuccess: () => {
      setStopping(false)
      void refresh()
    },
    onError: toastError,
  })
  const retry = async (file: ProcessingFile) => {
    setRetrying((ids) => [...ids, file.job.id])
    try {
      await filesItemReprocess({ path: { item_id: file.item_id }, throwOnError: true })
      await refresh()
    } catch (error) {
      toastError(error)
    }
    setRetrying((ids) => ids.filter((id) => id !== file.job.id))
  }

  if (!list) return <Spinner className="mx-auto" />
  const running = active.filter((file) => file.job.status === 'running')
  const queued = active.filter((file) => file.job.status === 'pending')
  const hidden = list.active - active.length
  const total = list.active + list.done
  const headline =
    list.active > 0
      ? m.files_processing_headline_running({ done: list.done, total })
      : failed.some((file) => file.job.status === 'failed')
        ? m.files_processing_headline_failed()
        : m.files_processing_headline_done()

  const row = (file: ProcessingFile) => (
    <FileRow
      key={file.job.id}
      file={file}
      retrying={retrying.includes(file.job.id)}
      onRetry={() => void retry(file)}
      onOpen={onClose}
    />
  )

  return (
    <div className="-m-4 flex max-h-[min(36rem,75vh)] flex-col">
      <div className="relative flex items-center gap-3 border-b py-3 pr-2.5 pl-4">
        <PopoverHeader className="min-w-0 flex-1 gap-0">
          <PopoverTitle className="truncate text-sm">{m.files_processing_title()}</PopoverTitle>
          <PopoverDescription className="text-xs tabular-nums">{headline}</PopoverDescription>
        </PopoverHeader>
        <PanelIconAction
          label={m.files_processing_stop_all()}
          disabled={list.active === 0}
          onClick={() => setStopping(true)}
        >
          <CircleStop aria-hidden />
        </PanelIconAction>
        {list.active > 0 ? (
          <Progress
            value={(list.done / total) * 100}
            aria-label={headline}
            className="absolute inset-x-0 -bottom-px [&_[data-slot=progress-track]]:h-0.5 [&_[data-slot=progress-track]]:rounded-none"
          />
        ) : null}
      </div>

      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-2 pb-3">
        {failed.length > 0 ? (
          <section className="flex flex-col gap-1">
            <PanelHeading count={failed.length}>{m.files_processing_failed()}</PanelHeading>
            <ItemGroup className="gap-0 has-data-[size=xs]:gap-0">{failed.map(row)}</ItemGroup>
          </section>
        ) : null}
        {running.length > 0 ? (
          <section className="flex flex-col gap-1">
            <PanelHeading count={running.length}>{m.files_processing_running()}</PanelHeading>
            <ItemGroup className="gap-0 has-data-[size=xs]:gap-0">{running.map(row)}</ItemGroup>
          </section>
        ) : null}
        {queued.length > 0 ? (
          <section className="flex flex-col gap-1">
            <PanelHeading count={queued.length + hidden}>
              {m.files_processing_queued()}
            </PanelHeading>
            <ItemGroup className="gap-0 has-data-[size=xs]:gap-0">{queued.map(row)}</ItemGroup>
            {hidden > 0 ? (
              <p className="px-2 pt-1 text-xs text-muted-foreground">
                {m.files_processing_more({ count: hidden })}
              </p>
            ) : null}
          </section>
        ) : null}
        {done.length > 0 ? (
          <section className="flex flex-col gap-0.5 border-t px-2 pt-2">
            <PanelMoreList label={m.files_processing_done()} count={done.length}>
              {done.map(row)}
            </PanelMoreList>
          </section>
        ) : null}
      </div>

      <ConfirmDialog
        open={stopping}
        onOpenChange={setStopping}
        title={m.files_processing_stop_all_title()}
        description={m.files_processing_stop_all_description()}
        confirmLabel={m.files_processing_stop_all()}
        pending={stopAll.isPending}
        onConfirm={() => stopAll.mutate({})}
      />
    </div>
  )
}

/** One file: live progress while it runs, its stage or why it failed, and stop or retry. */
function FileRow({
  file,
  retrying,
  onRetry,
  onOpen,
}: {
  file: ProcessingFile
  retrying: boolean
  onRetry: () => void
  onOpen: () => void
}) {
  // Live over SSE, seeded with the listed state.
  const live = useJob(file.job.id, file.job)
  const status = live.status ?? file.job.status
  const ended = !isActive({ ...file, job: { ...file.job, status } })
  const failed = status === 'failed' || status === 'cancelled'
  const code = live.job?.error_code ?? file.job.error_code
  const detail =
    status === 'running'
      ? live.stageLabel
      : status === 'pending'
        ? m.job_pending()
        : status === 'cancelled'
          ? m.job_cancelled()
          : status === 'failed'
            ? errorMessage({ error: { code: code ?? 'files.parse_failed' } })
            : m.files_processing_done()
  return (
    <PanelFold leaving={false}>
      <PanelRow
        icon={fileIcon({ kind: 'file', mime_type: file.mime_type })}
        spin={status === 'running' && !live.waiting}
        tone={status === 'failed' ? 'error' : undefined}
        title={file.name}
        course={file.course_code}
        color={file.course_color}
        detail={detail}
        muted={status === 'cancelled'}
        time={status === 'running' && !live.waiting ? `${live.progress}%` : undefined}
        href={filePath(file.program_id, {
          id: file.item_id,
          course_id: file.course_id,
          folder_id: file.folder_id,
        })}
        onOpen={onOpen}
      >
        {!ended ? (
          <PanelIconAction
            label={m.files_processing_stop({ name: file.name })}
            disabled={live.cancelling}
            onClick={live.cancel}
            className="opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100"
          >
            <X aria-hidden />
          </PanelIconAction>
        ) : failed ? (
          <PanelIconAction
            label={m.files_processing_retry()}
            disabled={retrying}
            onClick={onRetry}
            className="opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100"
          >
            <RotateCw aria-hidden />
          </PanelIconAction>
        ) : null}
      </PanelRow>
    </PanelFold>
  )
}
