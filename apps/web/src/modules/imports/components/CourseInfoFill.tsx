import type { ImportSessionDetail, ItemOut } from '@semestra/api-client'
import {
  importsSessionCommitMutation,
  importsSessionDiscardMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FileText, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { invalidateOperations } from '@/app/api'
import { SettingRow, SettingsGroup } from '@/app/settings'
import { AiAction } from '@/components/AiAction'
import { AiRequired } from '@/components/AiRequired'
import { useJob } from '@/hooks/use-job'
import { errorMessage, toastError } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { useCourseFiles } from '@/modules/files/queries'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/ui/command'
import { Item, ItemActions, ItemContent } from '@/ui/item'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { invalidateAfterCommit, settleEdits, storeSession, useImportSession } from '../queries'
import { SOURCES, readableCourseFile } from '../sources'
import type { FileImportRequest } from '../types'
import { PatchEditor } from './ItemEditor'
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
 * "Read from syllabus" at the top of a course's basics (M08 §6.1): pick a course file or upload
 * one, watch it being read in place, then tick the changed fields and apply them. Applying is the
 * confirmation; nothing is written before.
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
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const session = useImportSession(sessionId).data
  const job = useJob(session?.status === 'extracting' ? session.job_id : null)
  const commit = useMutation({ ...importsSessionCommitMutation(), onError: toastError })
  const discard = useMutation({ ...importsSessionDiscardMutation(), onError: toastError })
  const files = syllabusCandidates(useCourseFiles(courseId).data?.items ?? [])

  const request: FileImportRequest = {
    programId,
    source: 'syllabus',
    target: { kind: 'course', course_id: courseId },
    mode: 'direct',
    sourceMeta: { only: 'course_info' },
  }

  const start = (picked: { fileItemIds: string[]; upload: File[] }) => {
    setPickerOpen(false)
    setSessionId(null)
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
        setSessionId(created.id)
      })
      .catch((caught: unknown) => setStartError(errorMessage(caught)))
      .then(() => setStarting(false))
  }

  const reset = () => {
    setSessionId(null)
    setStartError(null)
  }
  const stop = (current: ImportSessionDetail) =>
    discard.mutate(
      { path: { session_id: current.id } },
      {
        onSuccess: () => {
          void invalidateOperations(queryClient, ['importsSessionGet', 'importsSessionList'])
          reset()
        },
      },
    )
  const apply = async (current: ImportSessionDetail) => {
    await settleEdits()
    const result = await commit
      .mutateAsync({ path: { session_id: current.id }, body: {} })
      .catch(() => null) // reported by onError
    if (!result) return
    await invalidateAfterCommit(queryClient)
    toast.success(m.imports_course_info_applied())
    reset()
    onApplied()
  }

  const extracting = starting || session?.status === 'extracting'
  const patch =
    session?.status === 'ready' ? session.items.find((i) => i.type === 'course_patch') : undefined
  let note: string | null = null
  let failed = Boolean(startError)
  if (startError) note = startError
  else if (session?.status === 'ready' && !patch) note = m.imports_up_to_date()
  else if (session?.status === 'failed') {
    if (session.error_code === 'import.no_changes') note = m.imports_up_to_date()
    else {
      failed = true
      note = errorMessage({
        error: { code: session.error_code ?? 'import.no_content', params: {} },
      })
    }
  }

  const picker = (
    <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
      <AiRequired purpose="extraction">
        <PopoverTrigger render={<Button variant="outline" size="sm" />}>
          <FileText aria-hidden />
          {m.imports_course_info_pick()}
        </PopoverTrigger>
      </AiRequired>
      <PopoverContent align="end" className="w-80 p-0">
        <Command>
          <CommandInput placeholder={m.imports_course_info_search()} />
          <CommandList>
            <CommandEmpty>{m.imports_course_info_no_files()}</CommandEmpty>
            {files.length > 0 ? (
              <CommandGroup heading={m.imports_from_course_files()}>
                {files.map((file) => (
                  <CommandItem
                    key={file.id}
                    value={`${file.display_name} ${file.id}`}
                    onSelect={() => start({ fileItemIds: [file.id], upload: [] })}
                  >
                    <FileText aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{file.display_name}</span>
                    {SYLLABUS_NAME.test(file.display_name) ? (
                      <Badge variant="secondary">{m.imports_course_info_syllabus()}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {formatDate(file.created_at)}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                value="__upload__"
                forceMount
                onSelect={() => {
                  setPickerOpen(false)
                  fileInput.current?.click()
                }}
              >
                <Upload aria-hidden />
                {m.imports_course_info_upload()}
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )

  return (
    <SettingsGroup>
      <SettingRow
        label={m.imports_course_info_title()}
        description={
          note ? (
            <span className={failed ? 'text-destructive' : undefined}>{note}</span>
          ) : (
            m.imports_course_info_description()
          )
        }
      >
        {() =>
          extracting ? (
            <AiAction
              state="running"
              label={m.imports_extracting()}
              progress={session?.job_id ? job.progress : undefined}
              stageLabel={job.stageLabel || m.imports_extracting()}
              cancelling={discard.isPending}
              className="w-56"
              onCancel={session ? () => stop(session) : undefined}
            />
          ) : (
            picker
          )
        }
      </SettingRow>
      {session && patch ? (
        <Item className="flex-col items-stretch gap-3">
          <ItemContent>
            <PatchEditor item={patch} editable={!commit.isPending} />
          </ItemContent>
          <ItemActions className="justify-end">
            <Button
              variant="ghost"
              size="sm"
              disabled={discard.isPending}
              onClick={() => stop(session)}
            >
              {m.imports_discard()}
            </Button>
            <Button size="sm" disabled={commit.isPending} onClick={() => void apply(session)}>
              {m.imports_course_info_apply()}
            </Button>
          </ItemActions>
        </Item>
      ) : null}
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
    </SettingsGroup>
  )
}
