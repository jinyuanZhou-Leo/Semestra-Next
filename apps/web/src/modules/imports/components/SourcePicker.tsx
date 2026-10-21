import type { ImportSessionDetail } from '@semestra/api-client'
import { importsSessionCreate, importsUploadCreate } from '@semestra/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { FileUp, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { AiAction, type AiActionState } from '@/components/AiAction'
import { AiRequired } from '@/components/AiRequired'
import { useJob } from '@/hooks/use-job'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { DialogFooter } from '@/ui/dialog'
import { Textarea } from '@/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { storeSession } from '../queries'
import { SOURCES } from '../sources'
import type { FileImportRequest } from '../types'
import { FileStatusList, sessionRows } from './FileStatusList'

/** Upload takes the first fifth of the bar; the extraction job fills the rest. */
const UPLOAD_SHARE = 20
/** How long the finished check shows before the review replaces the picker. */
const SUCCESS_HOLD_MS = 1000

/** Uploads the files one by one, then starts the session (ICS is parsed right away). */
async function createSession(
  request: FileImportRequest,
  files: File[],
  text: string | null,
  signal: AbortSignal,
  onUploaded: (count: number) => void,
) {
  const uploadIds: string[] = []
  for (const file of files) {
    const { data } = await importsUploadCreate({ body: { file }, signal, throwOnError: true })
    uploadIds.push(data.id)
    onUploaded(uploadIds.length)
  }
  const { data } = await importsSessionCreate({
    path: { program_id: request.programId },
    body: {
      source_kind: request.source,
      target: request.target,
      upload_ids: uploadIds,
      text,
      source_meta: request.sourceMeta ?? {},
    },
    signal,
    throwOnError: true,
  })
  return data
}

/**
 * The first step of a file or text import (M08 §6.2). The "Read" button is the progress bar for the
 * whole start: uploading the files, then the extraction job, then a check before `onFinished`
 * opens the review. The body keeps listing the files with their state while it runs.
 */
export function SourcePicker({
  request,
  session,
  onStarted,
  onFinished,
}: {
  request: FileImportRequest
  /** The session this picker started, kept in step with the server. */
  session: ImportSessionDetail | undefined
  onStarted: (sessionId: string) => void
  onFinished: () => void
}) {
  const inputId = useId()
  const queryClient = useQueryClient()
  const spec = SOURCES[request.source]
  const [files, setFiles] = useState<File[]>([])
  const [text, setText] = useState('')
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'creating'>('idle')
  const [uploaded, setUploaded] = useState(0)
  const [startError, setStartError] = useState<string | null>(null)
  const [cancelled, setCancelled] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const job = useJob(session?.status === 'extracting' ? session.job_id : null)
  const ready = spec.accept ? files.length > 0 : text.trim().length > 0

  const extracting = session?.status === 'extracting'
  const starting = phase !== 'idle'
  let state: AiActionState = 'idle'
  let error: string | null = null
  if (starting || extracting) {
    state = 'running'
  } else if (session && !cancelled) {
    state = session.status === 'failed' ? 'error' : 'success'
    if (session.status === 'failed') {
      error = errorMessage({
        error: { code: session.error_code ?? 'import.no_content', params: {} },
      })
    }
  } else if (startError) {
    state = 'error'
    error = startError
  }
  const locked = state === 'running' || state === 'success'

  useEffect(() => {
    if (state !== 'success') return
    const timer = window.setTimeout(onFinished, SUCCESS_HOLD_MS)
    return () => window.clearTimeout(timer)
  }, [state, onFinished])

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
  const uploadedBytes = files.slice(0, uploaded).reduce((sum, file) => sum + file.size, 0)
  let progress = UPLOAD_SHARE
  let stageLabel: string | undefined
  if (phase === 'uploading') {
    progress = totalBytes > 0 ? (UPLOAD_SHARE * uploadedBytes) / totalBytes : 0
    stageLabel = m.job_stage_count({
      stage: m.imports_uploading(),
      current: Math.min(uploaded + 1, files.length),
      total: files.length,
    })
  } else if (extracting) {
    progress = UPLOAD_SHARE + ((100 - UPLOAD_SHARE) * job.progress) / 100
    stageLabel = job.stageLabel || undefined
  }

  const start = () => {
    const controller = new AbortController()
    abort.current = controller
    setStartError(null)
    setCancelled(false)
    setUploaded(0)
    setPhase(files.length > 0 ? 'uploading' : 'creating')
    createSession(request, files, spec.accept ? null : text, controller.signal, (count) => {
      setUploaded(count)
      if (count === files.length) setPhase('creating')
    })
      .then((created) => {
        storeSession(queryClient, created)
        onStarted(created.id)
      })
      .catch((caught: unknown) => {
        // Stopping during the upload is the user's choice, not a failure.
        if (!controller.signal.aborted) setStartError(errorMessage(caught))
      })
      .finally(() => setPhase('idle'))
  }
  const cancel = () => {
    if (phase !== 'idle') {
      abort.current?.abort()
      return
    }
    setCancelled(true)
    job.cancel()
  }

  const action = (
    <AiAction
      state={state}
      label={m.imports_start()}
      progress={progress}
      stageLabel={stageLabel}
      error={error}
      cancelling={extracting && job.cancelling}
      disabled={!ready}
      onClick={start}
      onCancel={cancel}
    />
  )

  const addFiles = (added: File[]) =>
    setFiles((current) => (spec.multiple ? [...current, ...added] : added.slice(0, 1)))
  const rows = session?.status === 'extracting' ? sessionRows(session.source_refs) : null

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {spec.accept ? (
          <>
            {locked ? null : (
              // Dropping files on the picker is a shortcut; the file input inside is the control.
              // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
              <label
                htmlFor={inputId}
                className={cn(
                  'flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed text-sm text-muted-foreground hover:bg-muted/50',
                  files.length === 0 ? 'min-h-40 flex-1 flex-col' : 'flex-row px-4 py-3',
                )}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault()
                  addFiles([...event.dataTransfer.files])
                }}
              >
                <FileUp aria-hidden className={files.length === 0 ? 'size-6' : 'size-4'} />
                {files.length > 0
                  ? m.imports_add_more()
                  : spec.multiple
                    ? m.imports_pick_files()
                    : m.imports_pick_file()}
                <input
                  id={inputId}
                  type="file"
                  className="sr-only"
                  accept={spec.accept}
                  multiple={spec.multiple}
                  onChange={(event) => {
                    addFiles([...(event.target.files ?? [])])
                    event.target.value = ''
                  }}
                />
              </label>
            )}
            {locked ? (
              <FileStatusList
                rows={
                  rows ??
                  files.map((file, index) => ({
                    key: `${file.name}-${index}`,
                    name: file.name,
                    status:
                      session && state === 'success'
                        ? 'done'
                        : index < uploaded
                          ? 'done'
                          : phase === 'uploading' && index === uploaded
                            ? 'uploading'
                            : 'pending',
                  }))
                }
              />
            ) : (
              <ul className="space-y-1">
                {files.map((file, index) => (
                  <li
                    // Files have no ids; the list only grows or loses entries by position.
                    // oxlint-disable-next-line react/no-array-index-key
                    key={`${file.name}-${index}`}
                    className="flex items-center gap-2 rounded-xl px-2 py-1 text-sm hover:bg-muted/50"
                  >
                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={m.imports_remove_file({ name: file.name })}
                            onClick={() =>
                              setFiles((current) => current.filter((_, i) => i !== index))
                            }
                          />
                        }
                      >
                        <X aria-hidden />
                      </TooltipTrigger>
                      <TooltipContent>{m.imports_remove_file({ name: file.name })}</TooltipContent>
                    </Tooltip>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <Textarea
            aria-label={m.imports_source_text()}
            placeholder={m.imports_text_placeholder()}
            className="min-h-40 flex-1 resize-none"
            value={text}
            disabled={locked}
            onChange={(event) => setText(event.target.value)}
          />
        )}
      </div>
      <DialogFooter className="items-start">
        {spec.purpose ? <AiRequired purpose={spec.purpose}>{action}</AiRequired> : action}
      </DialogFooter>
    </>
  )
}
