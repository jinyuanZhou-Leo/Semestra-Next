import type { ImportSessionDetail, Upload } from '@semestra/api-client'
import { importsSessionCreate, importsSessionDiscard } from '@semestra/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { FileUp } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { toast } from 'sonner'
import { AiAction, type AiActionState } from '@/components/AiAction'
import { AiRequired } from '@/components/AiRequired'
import { useJob } from '@/hooks/use-job'
import { invalidateOperations, postWithProgress } from '@/app/api'
import { errorMessage, toastError } from '@/lib/errors'
import { formatBytes } from '@/lib/format'
import { SEGMENT, SEGMENTED } from '@/lib/segmented'
import { cn } from '@/lib/utils'
import { useFilesUsage } from '@/modules/files/queries'
import { m } from '@/paraglide/messages'
import { Checkbox } from '@/ui/checkbox'
import { DialogFooter } from '@/ui/dialog'
import { Field, FieldLabel } from '@/ui/field'
import { Textarea } from '@/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'
import { storeSession } from '../queries'
import { SOURCES } from '../sources'
import type { FileImportRequest } from '../types'
import { CourseFilePicker } from './CourseFilePicker'
import { type FileRow, FileStatusList, sessionRows } from './FileStatusList'
import { SUCCESS_HOLD_MS } from './SessionView'

/** Upload takes the first fifth of the bar; the extraction job fills the rest. */
const UPLOAD_SHARE = 20

/** One file of the import, with byte progress. */
function uploadFile(file: File, signal: AbortSignal, onProgress: (loaded: number) => void) {
  const form = new FormData()
  form.append('file', file)
  return postWithProgress<Upload>('/imports/uploads', form, { signal, onProgress })
}

/**
 * Uploads the files one by one, then starts the session (ICS is parsed right away). Picked course
 * files are not uploaded: the session reads them from M07.
 */
export async function uploadAndCreate(
  request: FileImportRequest,
  files: File[],
  fileItemIds: string[],
  text: string | null,
  sourceMeta: Record<string, unknown>,
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
      file_item_ids: fileItemIds,
      text,
      source_meta: sourceMeta,
    },
    throwOnError: true,
  })
  return data
}

/**
 * The first step of a file or text import (M08 §6.2). The "Read" button is the progress bar for the
 * whole start: uploading the files, then the extraction job, then a check before `onFinished`
 * opens the review. The drop zone keeps its height throughout and the files below it show their
 * own state (each upload with its bar), so nothing moves while the import starts. A syllabus for
 * a course can also be read from the course's files instead of uploading it again.
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
  const keepId = useId()
  const queryClient = useQueryClient()
  const spec = SOURCES[request.source]
  const maxBytes = useFilesUsage().data?.max_upload_bytes
  const courseId =
    request.source === 'syllabus' && request.target.kind === 'course'
      ? request.target.course_id
      : null
  const [from, setFrom] = useState<'upload' | 'course'>(
    courseId && request.fileItemIds?.length ? 'course' : 'upload',
  )
  const [files, setFiles] = useState<File[]>([])
  const [picked, setPicked] = useState<string[]>(request.fileItemIds ?? [])
  const [keepFiles, setKeepFiles] = useState(true)
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
  const fromCourse = from === 'course'
  const sending = fromCourse ? [] : files
  const ready = fromCourse
    ? picked.length > 0
    : spec.accept
      ? files.length > 0
      : text.trim().length > 0

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

  const totalBytes = sending.reduce((sum, file) => sum + file.size, 0)
  let progress = UPLOAD_SHARE
  let stageLabel: string | undefined
  if (phase === 'uploading') {
    progress = totalBytes > 0 ? (UPLOAD_SHARE * uploaded.bytes) / totalBytes : 0
    stageLabel = m.job_stage_count({
      stage: m.imports_uploading(),
      current: Math.min(uploaded.count + 1, sending.length),
      total: sending.length,
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
    setPhase(sending.length > 0 ? 'uploading' : 'creating')
    const sourceMeta = {
      ...request.sourceMeta,
      // An uploaded syllabus is filed into the course on commit unless the box was unticked.
      ...(sending.length > 0 && !keepFiles ? { keep_files: false } : {}),
    }
    uploadAndCreate(
      request,
      sending,
      fromCourse ? picked : [],
      spec.accept ? null : text,
      sourceMeta,
      controller.signal,
      (bytes, count) => {
        if (!mounted.current) return
        setUploaded({ bytes, count })
        if (count === sending.length) setPhase('creating')
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

  const addFiles = (added: File[]) =>
    setFiles((current) => (spec.multiple ? [...current, ...added] : added.slice(0, 1)))
  const dropzone = useDropzone({
    accept: spec.accept,
    multiple: spec.multiple ?? false,
    disabled: locked || !spec.accept,
    onDropAccepted: addFiles,
    maxSize: maxBytes,
    onDropRejected: (rejected) => {
      for (const { file, errors } of rejected) {
        const code = errors[0]?.code
        // A single-file source keeps the first file and drops the rest without a word.
        if (code === 'too-many-files') continue
        toast.error(
          code === 'file-too-large' && maxBytes
            ? m.files_upload_too_large({ name: file.name, max: formatBytes(maxBytes) })
            : m.imports_file_type_unsupported({ name: file.name }),
        )
      }
    },
  })

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

  // Once started the rows follow the server: first the uploads, then reading each file.
  let rows: FileRow[]
  if (session?.status === 'extracting') {
    rows = sessionRows(
      session.source_refs,
      sending.map((file) => file.size),
    )
  } else if (fromCourse) {
    rows = []
  } else {
    let before = 0
    rows = files.map((file, index) => {
      const sentBefore = before
      before += file.size
      let status: FileRow['status'] = 'picked'
      if (locked) {
        status =
          (session && state === 'success') || index < uploaded.count
            ? 'done'
            : phase === 'uploading' && index === uploaded.count
              ? 'uploading'
              : 'pending'
      }
      return {
        // Files have no ids; the list only grows or loses entries by position.
        key: `${file.name}-${index}`,
        name: file.name,
        size: file.size,
        status,
        loaded: Math.max(0, uploaded.bytes - sentBefore),
        onRemove: locked
          ? undefined
          : () => setFiles((current) => current.filter((_, i) => i !== index)),
      }
    })
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {courseId ? (
          <ToggleGroup
            value={[from]}
            onValueChange={(value: string[]) => {
              const next = value[0]
              if (next === 'upload' || next === 'course') setFrom(next)
            }}
            disabled={locked}
            className={SEGMENTED}
          >
            <ToggleGroupItem value="upload" className={SEGMENT}>
              {m.imports_from_upload()}
            </ToggleGroupItem>
            <ToggleGroupItem value="course" className={SEGMENT}>
              {m.imports_from_course_files()}
            </ToggleGroupItem>
          </ToggleGroup>
        ) : null}
        {!spec.accept ? (
          <Textarea
            aria-label={m.imports_source_text()}
            placeholder={m.imports_text_placeholder()}
            className="min-h-40 flex-1 resize-none"
            value={text}
            disabled={locked}
            onChange={(event) => setText(event.target.value)}
          />
        ) : fromCourse && courseId && !extracting ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <CourseFilePicker
              courseId={courseId}
              picked={picked}
              disabled={locked}
              onChange={setPicked}
            />
          </div>
        ) : (
          <>
            {fromCourse ? null : (
              <div
                {...dropzone.getRootProps({
                  className: cn(
                    'flex h-40 shrink-0 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-4 text-center text-sm text-muted-foreground transition-colors outline-none hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
                    dropzone.isDragActive && 'border-primary bg-primary/5',
                    locked && 'pointer-events-none opacity-50',
                  ),
                })}
              >
                <input {...dropzone.getInputProps()} />
                <span className="flex size-10 items-center justify-center rounded-full bg-muted text-foreground">
                  <FileUp aria-hidden className="size-5" />
                </span>
                <span className="text-foreground">
                  {spec.multiple ? m.imports_pick_files() : m.imports_pick_file()}
                </span>
                {maxBytes ? (
                  <span className="text-xs">
                    {m.imports_pick_limit({ max: formatBytes(maxBytes) })}
                  </span>
                ) : null}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <FileStatusList rows={rows} />
            </div>
          </>
        )}
        {request.source === 'syllabus' && !fromCourse ? (
          <Field orientation="horizontal" className="w-fit">
            <Checkbox
              id={keepId}
              checked={keepFiles}
              disabled={locked}
              onCheckedChange={setKeepFiles}
            />
            <FieldLabel htmlFor={keepId} className="font-normal">
              {m.imports_keep_files()}
            </FieldLabel>
          </Field>
        ) : null}
      </div>
      <DialogFooter className="items-start">
        {spec.purpose ? <AiRequired purpose={spec.purpose}>{action}</AiRequired> : action}
      </DialogFooter>
    </>
  )
}
