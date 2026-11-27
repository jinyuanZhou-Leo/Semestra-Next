import type { ImportSession, ItemOut } from '@semestra/api-client'
import {
  academicsCourseGetOptions,
  importsSessionDiscardMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Upload } from 'lucide-react'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { invalidateOperations } from '@/app/api'
import { SettingRow, SettingsGroup } from '@/app/settings'
import { AiAction } from '@/components/AiAction'
import { AiRequired, useProviderProblem } from '@/components/AiRequired'
import { useJob } from '@/hooks/use-job'
import { errorCode, errorMessage, toastError } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { FilePicker } from '@/modules/files/components/FilePicker'
import { useCourseFiles } from '@/modules/files/queries'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { openImport } from '../launcher'
import { storeSession, useImportSession } from '../queries'
import { SOURCES, readableCourseFile } from '../sources'
import { isReading } from '../status'
import type { FileImportRequest } from '../types'
import { type ImportKey, sessionRequest, useUnfinishedImport } from '../unfinished'
import { uploadAndCreate } from './SourcePicker'

/** What the upload picker offers: the syllabus source's types and extensions. */
const ACCEPT = Object.entries(SOURCES.syllabus.accept ?? {})
  .flatMap(([type, extensions]) => [type, ...extensions])
  .join(',')

/** File names that are most likely the syllabus; they are listed first. */
const SYLLABUS_NAME = /syllabus|outline|course[ _-]?info|大纲|教学大纲/i

/** Course files to read: likely syllabi first, then the newest. */
export function syllabusCandidates(items: readonly ItemOut[]): ItemOut[] {
  return items
    .filter(readableCourseFile)
    .toSorted(
      (a, b) =>
        Number(SYLLABUS_NAME.test(b.display_name)) - Number(SYLLABUS_NAME.test(a.display_name)) ||
        b.created_at.localeCompare(a.created_at),
    )
}

/**
 * "Read from a file" at the top of a course's basics (M08 §6.1): pick a course file or upload
 * one and watch it being read in place; the changed fields then open in the import dialog to
 * tick and apply. Applying is the confirmation; nothing is written before. The row follows the
 * course's unfinished import on the server, so leaving the page loses nothing: coming back shows
 * it still reading, or waiting for review with a button to open it.
 */
export function CourseInfoFill({
  programId,
  courseId,
  onApplied,
}: {
  programId: string
  courseId: string
  onApplied: () => void
}) {
  const queryClient = useQueryClient()
  const key: ImportKey = {
    source: 'syllabus',
    target: { kind: 'course', course_id: courseId },
    only: 'course_info',
  }
  const waiting = useUnfinishedImport(programId, key)
  // Started here: its review opens when the reading ends (the user is watching this row), and
  // an outcome without a review ("up to date", a failure) is said in the row.
  const [startedId, setStartedId] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<unknown>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const started = useImportSession(startedId).data
  const session: Pick<ImportSession, 'id' | 'status' | 'job_id' | 'error_code'> | undefined =
    waiting ?? started
  const job = useJob(isReading(session) ? session?.job_id : null)
  const discard = useMutation({ ...importsSessionDiscardMutation(), onError: toastError })
  const course = useQuery(academicsCourseGetOptions({ path: { course_id: courseId } })).data
  // Likely syllabi: their folders start open.
  const suggested = (useCourseFiles(courseId).data?.items ?? [])
    .filter((file) => readableCourseFile(file) && SYLLABUS_NAME.test(file.display_name))
    .map((file) => file.id)

  const request: FileImportRequest = {
    programId,
    source: 'syllabus',
    target: { kind: 'course', course_id: courseId },
    mode: 'direct',
    sourceMeta: { only: 'course_info' },
  }

  const start = (picked: { fileItemIds: string[]; upload: File[] }) => {
    // Reading again: the failure this row showed has been seen.
    if (waiting?.status === 'failed') discard.mutate({ path: { session_id: waiting.id } })
    setPickerOpen(false)
    setStartedId(null)
    setStartError(null)
    setStarting(true)
    uploadAndCreate(
      request,
      picked.upload,
      picked.fileItemIds,
      null,
      request.sourceMeta ?? {},
      new AbortController().signal,
      () => {},
    )
      .then((created) => {
        storeSession(queryClient, created)
        setStartedId(created.id)
        void invalidateOperations(queryClient, ['importsSessionList'])
      })
      .catch((caught: unknown) => setStartError(caught))
      .then(() => setStarting(false))
  }

  const stop = (id: string) =>
    discard.mutate(
      { path: { session_id: id } },
      {
        onSuccess: () => {
          void invalidateOperations(queryClient, ['importsSessionGet', 'importsSessionList'])
          setStartedId(null)
        },
      },
    )
  const review = async (target: ImportSession) => {
    const outcome = await openImport(sessionRequest(target))
    if (outcome?.session.status === 'committed') onApplied()
  }

  // The reading started here has ended while the user watched: its review opens.
  const readyHere = waiting?.status === 'ready' && waiting.id === startedId ? waiting : null
  const readyId = readyHere?.id
  const openReady = useEffectEvent(() => {
    if (readyHere) void review(readyHere)
  })
  useEffect(() => {
    if (readyId) openReady()
  }, [readyId])

  const reading = starting || isReading(session)
  let failedCode: string | null = null
  let note: string | null = null
  if (startError) {
    failedCode = errorCode(startError)
    note = errorMessage(startError)
  } else if (!waiting && started?.status === 'up_to_date') {
    note = m.imports_up_to_date()
  } else if (session?.status === 'failed') {
    failedCode = session.error_code ?? 'import.no_content'
    note = errorMessage({ error: { code: failedCode, params: {} } })
  } else if (waiting?.status === 'ready') {
    note = m.imports_status_ready()
  }
  const provider = useProviderProblem('extraction', failedCode)

  const picker = (
    <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
      <AiRequired purpose="extraction">
        <PopoverTrigger render={<Button variant="outline" size="sm" />}>
          <FileText aria-hidden />
          {m.imports_course_info_pick()}
        </PopoverTrigger>
      </AiRequired>
      <PopoverContent align="end" className="w-96 gap-2 p-2">
        <FilePicker
          courses={course ? [course] : []}
          mode="single"
          autoFocus
          filter={readableCourseFile}
          reveal={suggested}
          onPick={(file) => start({ fileItemIds: [file.id], upload: [] })}
          meta={(file) =>
            SYLLABUS_NAME.test(file.display_name)
              ? m.imports_course_info_syllabus()
              : formatDate(file.created_at, { short: true })
          }
          emptyTitle={m.imports_course_files_empty()}
          className="h-80"
        />
        <Button
          variant="ghost"
          className="justify-start"
          onClick={() => {
            setPickerOpen(false)
            fileInput.current?.click()
          }}
        >
          <Upload aria-hidden />
          {m.imports_course_info_upload()}
        </Button>
      </PopoverContent>
    </Popover>
  )

  let control
  if (reading) {
    control = (
      <AiAction
        state="running"
        label={m.imports_extracting()}
        progress={session?.job_id ? job.progress : undefined}
        stageLabel={job.stageLabel || m.imports_extracting()}
        cancelling={discard.isPending}
        className="w-60"
        onCancel={session ? () => stop(session.id) : undefined}
      />
    )
  } else if (waiting?.status === 'ready') {
    control = (
      <Button size="sm" onClick={() => void review(waiting)}>
        {m.imports_review_open()}
      </Button>
    )
  } else if (provider) {
    control = (
      <span className="inline-flex items-center gap-2">
        {picker}
        <Button size="sm" onClick={provider.fix}>
          {provider.action}
        </Button>
      </span>
    )
  } else {
    control = picker
  }

  return (
    <>
      <SettingsGroup>
        <SettingRow
          label={m.imports_course_info_title()}
          description={
            note ? (
              <span className={failedCode ? 'text-destructive' : undefined}>
                {provider?.title ?? note}
              </span>
            ) : (
              m.imports_course_info_description()
            )
          }
        >
          {() => control}
        </SettingRow>
      </SettingsGroup>
      {/* Outside the group, which puts a separator before every child. */}
      <input
        ref={fileInput}
        type="file"
        hidden
        accept={ACCEPT}
        onChange={(event) => {
          const picked = [...(event.target.files ?? [])]
          event.target.value = ''
          if (picked.length > 0) start({ fileItemIds: [], upload: picked.slice(0, 1) })
        }}
      />
    </>
  )
}
