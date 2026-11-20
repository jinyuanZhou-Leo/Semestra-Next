import type { ProcessingFile } from '@semestra/api-client'
import { filesItemReprocess } from '@semestra/api-client'
import {
  filesProcessingCancelAllMutation,
  filesProcessingListQueryKey,
  filesProcessingRetryMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleStop, RotateCw, X } from 'lucide-react'
import { useEffect, useEffectEvent, useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { PanelFold, PanelHeading, PanelMoreList, PanelRow } from '@/components/StatusPanel'
import { IconAction } from '@/components/IconAction'
import { useJob } from '@/hooks/use-job'
import { errorMessage, toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { ItemGroup } from '@/ui/item'
import { PopoverDescription, PopoverHeader, PopoverTitle } from '@/ui/popover'
import { Progress } from '@/ui/progress'
import { Spinner } from '@/ui/spinner'
import { fileIcon } from '../kinds'
import { filePath } from '../location'
import { processingOptions, setPanelOpen, shownFiles, useSeenFailures } from '../processing-line'

/** The part of the panel a row is listed in. */
type Section = 'failed' | 'running' | 'queued' | 'done'

const SECTION_OF: Record<string, Section> = {
  failed: 'failed',
  cancelled: 'failed',
  running: 'running',
  pending: 'queued',
  succeeded: 'done',
}

/**
 * The panel of the "Processing files" line (M07 §3.1): each file being read, waiting, or that
 * could not be read, with its course and state. A row opens the file; on hover it can be stopped
 * (or read again). "Stop all" stops the round, after a confirmation; once nothing is left,
 * "Process all again" reads the files that failed or were stopped.
 */
/** Failures remembered as seen: enough for a few rounds of a large sync. */
const SEEN_KEPT = 500

export default function ProcessingPanel({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const list = useQuery(processingOptions()).data
  const [seen, setSeen] = useSeenFailures()
  const [stopping, setStopping] = useState(false)
  const [retrying, setRetrying] = useState<readonly string[]>([])
  const { active, failed, done } = shownFiles(list, seen)

  // While it is open, the line keeps what it shows; what it lists that failed or was stopped
  // counts as seen once it closes (not on open: the line would change under the user).
  const markSeen = useEffectEvent(() => {
    const ids = failed.map((file) => file.job.id)
    if (ids.some((id) => !seen.includes(id))) {
      setSeen([...new Set([...ids, ...seen])].slice(0, SEEN_KEPT))
    }
  })
  // Rows that arrive once the panel is up unfold; the first ones are just there.
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setSettled(true))
    return () => cancelAnimationFrame(frame)
  }, [])
  useEffect(() => {
    setPanelOpen(true)
    return () => {
      setPanelOpen(false)
      markSeen()
    }
  }, [])

  const refresh = () => queryClient.invalidateQueries({ queryKey: filesProcessingListQueryKey() })
  const stopAll = useMutation({
    ...filesProcessingCancelAllMutation(),
    onSuccess: () => {
      setStopping(false)
      void refresh()
    },
    onError: toastError,
  })
  const retryAll = useMutation({
    ...filesProcessingRetryMutation(),
    onSuccess: () => void refresh(),
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
        : failed.length > 0
          ? m.files_processing_headline_stopped()
          : m.files_processing_headline_done()

  const row = (section: Section) => (file: ProcessingFile) => (
    <FileRow
      key={file.job.id}
      section={section}
      appear={settled}
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
        {list.active === 0 && failed.length > 0 ? (
          <IconAction
            className="text-muted-foreground"
            label={m.files_processing_retry_all()}
            disabled={retryAll.isPending}
            onClick={() =>
              retryAll.mutate({ body: { item_ids: failed.map((file) => file.item_id) } })
            }
          >
            <RotateCw aria-hidden />
          </IconAction>
        ) : (
          <IconAction
            className="text-muted-foreground"
            label={m.files_processing_stop_all()}
            disabled={list.active === 0}
            onClick={() => setStopping(true)}
          >
            <CircleStop aria-hidden />
          </IconAction>
        )}
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
            <ItemGroup className="gap-0 has-data-[size=xs]:gap-0">
              {failed.map(row('failed'))}
            </ItemGroup>
          </section>
        ) : null}
        {running.length > 0 ? (
          <section className="flex flex-col gap-1">
            <PanelHeading count={running.length}>{m.files_processing_running()}</PanelHeading>
            <ItemGroup className="gap-0 has-data-[size=xs]:gap-0">
              {running.map(row('running'))}
            </ItemGroup>
          </section>
        ) : null}
        {queued.length > 0 ? (
          <section className="flex flex-col gap-1">
            <PanelHeading count={queued.length + hidden}>
              {m.files_processing_queued()}
            </PanelHeading>
            <ItemGroup className="gap-0 has-data-[size=xs]:gap-0">
              {queued.map(row('queued'))}
            </ItemGroup>
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
              {done.map(row('done'))}
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

/** One file: live progress while it runs, its stage or why it failed, and stop or retry. When
 * its live state leaves the section it is listed in, the row folds away until the list catches
 * up (and shows it in its new section). */
function FileRow({
  file,
  section,
  appear,
  retrying,
  onRetry,
  onOpen,
}: {
  file: ProcessingFile
  section: Section
  appear: boolean
  retrying: boolean
  onRetry: () => void
  onOpen: () => void
}) {
  // Live over SSE, seeded with the listed state.
  const live = useJob(file.job.id, file.job)
  const status = live.status ?? file.job.status
  const ended = status !== 'pending' && status !== 'running'
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
    <PanelFold leaving={SECTION_OF[status] !== section} appear={appear}>
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
          <IconAction
            label={m.files_processing_stop({ name: file.name })}
            disabled={live.cancelling}
            onClick={live.cancel}
            className="text-muted-foreground opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100"
          >
            <X aria-hidden />
          </IconAction>
        ) : failed ? (
          <IconAction
            label={m.files_processing_retry()}
            disabled={retrying}
            onClick={onRetry}
            className="text-muted-foreground opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100"
          >
            <RotateCw aria-hidden />
          </IconAction>
        ) : null}
      </PanelRow>
    </PanelFold>
  )
}
