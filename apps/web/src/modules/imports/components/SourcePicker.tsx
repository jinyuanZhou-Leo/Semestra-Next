import type { ImportSessionDetail, Upload } from '@semestra/api-client'
import { client, importsSessionCreate, importsSessionDiscard } from '@semestra/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { FileUp, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { AiAction, type AiActionState } from '@/components/AiAction'
import { AiRequired } from '@/components/AiRequired'
import { useJob } from '@/hooks/use-job'
import { csrfHeaders, invalidateOperations, toApiError } from '@/app/api'
import { errorMessage, toastError } from '@/lib/errors'
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
import { SUCCESS_HOLD_MS } from './SessionView'

/** Upload takes the first fifth of the bar; the extraction job fills the rest. */
const UPLOAD_SHARE = 20

/**
 * One file as a multipart upload with real byte progress, which `fetch` cannot report. Stays
 * outside the generated client, so it adds the CSRF header itself.
 */
function uploadFile(file: File, signal: AbortSignal, onProgress: (loaded: number) => void) {
  return new Promise<Upload>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', `${client.getConfig().baseUrl ?? ''}/imports/uploads`)
    request.withCredentials = true
    for (const [name, value] of Object.entries(csrfHeaders())) request.setRequestHeader(name, value)
    request.upload.onprogress = (event) => onProgress(event.loaded)
    request.onload = () => {
      let body: unknown = null
      try {
        body = JSON.parse(request.responseText)
      } catch {
        // not JSON: handled as an unknown error below
      }
      if (request.status >= 200 && request.status < 300) resolve(body as Upload)
      else reject(toApiError(body, request.status))
    }
    request.onerror = () => reject(toApiError(null))
    request.onabort = () => reject(new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', () => request.abort(), { once: true })
    const form = new FormData()
    form.append('file', file)
    request.send(form)
  })
}

/** Uploads the files one by one, then starts the session (ICS is parsed right away). */
async function uploadAndCreate(
  request: FileImportRequest,
  files: File[],
  text: string | null,
  signal: AbortSignal,
  onUploaded: (bytes: number, count: number) => void,
) {
  const uploadIds: string[] = []
  let done = 0
  for (const file of files) {
    const upload = await uploadFile(file, signal, (loaded) =>
      onUploaded(done + loaded, uploadIds.length),
    )
    uploadIds.push(upload.id)
    done += file.size
    onUploaded(done, uploadIds.length)
  }
  // Not abortable: once the server has the request the session exists whether or not we hear back.
  const { data } = await importsSessionCreate({
    path: { program_id: request.programId },
    body: {
      source_kind: request.source,
      target: request.target,
      upload_ids: uploadIds,
      text,
      source_meta: request.sourceMeta ?? {},
    },
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
  const [uploaded, setUploaded] = useState({ bytes: 0, count: 0 })
  const [startError, setStartError] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const abort = useRef<AbortController | null>(null)
  // Read by the start request when it finishes: the user stopped, or closed the dialog, meanwhile.
  const stopRequested = useRef(false)
  const mounted = useRef(true)
  const job = useJob(session?.status === 'extracting' ? session.job_id : null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      // Closing the dialog while files are still uploading ends the upload; a session already
      // extracting stays and can be reopened.
      abort.current?.abort()
    }
  }, [])
  const ready = spec.accept ? files.length > 0 : text.trim().length > 0

  const extracting = session?.status === 'extracting'
  const starting = phase !== 'idle'
  let state: AiActionState = 'idle'
  let error: string | null = null
  if (starting || extracting) {
    state = 'running'
  } else if (startError) {
    // A new attempt that failed before it had a session: its reason, not the old session's.
    state = 'error'
    error = startError
  } else if (session && session.status !== 'discarded') {
    state = session.status === 'failed' ? 'error' : 'success'
    if (session.status === 'failed') {
      error = errorMessage({
        error: { code: session.error_code ?? 'import.no_content', params: {} },
      })
    }
  }
  const locked = state === 'running' || state === 'success'

  useEffect(() => {
    if (state !== 'success') return
    const timer = window.setTimeout(onFinished, SUCCESS_HOLD_MS)
    return () => window.clearTimeout(timer)
  }, [state, onFinished])

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
  let progress = UPLOAD_SHARE
  let stageLabel: string | undefined
  if (phase === 'uploading') {
    progress = totalBytes > 0 ? (UPLOAD_SHARE * uploaded.bytes) / totalBytes : 0
    stageLabel = m.job_stage_count({
      stage: m.imports_uploading(),
      current: Math.min(uploaded.count + 1, files.length),
      total: files.length,
    })
  } else if (extracting) {
    progress = UPLOAD_SHARE + ((100 - UPLOAD_SHARE) * job.progress) / 100
    stageLabel = job.stageLabel || undefined
  }

  const discard = (sessionId: string) =>
    importsSessionDiscard({ path: { session_id: sessionId }, throwOnError: true })
      .catch(toastError)
      .then(() => invalidateOperations(queryClient, ['importsSessionGet', 'importsSessionList']))

  const start = () => {
    const controller = new AbortController()
    abort.current = controller
    stopRequested.current = false
    setStartError(null)
    setStopping(false)
    setUploaded({ bytes: 0, count: 0 })
    setPhase(files.length > 0 ? 'uploading' : 'creating')
    uploadAndCreate(
      request,
      files,
      spec.accept ? null : text,
      controller.signal,
      (bytes, count) => {
        if (!mounted.current) return
        setUploaded({ bytes, count })
        if (count === files.length) setPhase('creating')
      },
    )
      .then((created) => {
        if (stopRequested.current || !mounted.current) return discard(created.id)
        storeSession(queryClient, created)
        onStarted(created.id)
      })
      .catch((caught: unknown) => {
        // Stopping during the upload is the user's choice, not a failure.
        if (!controller.signal.aborted && mounted.current) setStartError(errorMessage(caught))
      })
      .finally(() => {
        if (!mounted.current) return
        setPhase('idle')
        setStopping(false)
      })
  }
  const cancel = () => {
    if (phase === 'uploading') {
      abort.current?.abort()
      return
    }
    setStopping(true)
    if (phase === 'creating') {
      // The request is already on the server; the new session is discarded when it comes back.
      stopRequested.current = true
      return
    }
    // Discarding also cancels the job and deletes the uploads, and works on a session that
    // finished a moment ago.
    if (session) void discard(session.id).finally(() => setStopping(false))
  }

  const action = (
    <AiAction
      state={state}
      label={m.imports_start()}
      progress={progress}
      stageLabel={stageLabel}
      error={error}
      cancelling={stopping}
      disabled={!ready}
      className="w-56"
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
                  ? spec.multiple
                    ? m.imports_add_more()
                    : m.imports_replace_file()
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
                        : index < uploaded.count
                          ? 'done'
                          : phase === 'uploading' && index === uploaded.count
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
