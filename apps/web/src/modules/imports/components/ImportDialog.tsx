import { importsSessionCreate, importsUploadCreate } from '@semestra/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { FileUp, X } from 'lucide-react'
import { useId, useState } from 'react'
import { AiRequired } from '@/components/AiRequired'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog'
import { Textarea } from '@/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { storeSession, useImportSession } from '../queries'
import { SOURCES } from '../sources'
import type { ImportOutcome, ImportRequest } from '../types'
import { SessionView } from './SessionView'

/**
 * The import dialog an import source opens (M08 §6.2): pick the files (or paste text), then the
 * same session view as the session page. Its size is fixed from the first step on, so nothing
 * jumps when the review appears.
 */
export function ImportDialog({
  request,
  onClose,
}: {
  request: ImportRequest
  onClose: (outcome: ImportOutcome) => void
}) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const session = useImportSession(sessionId).data
  const spec = SOURCES[request.source]

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(null)}>
      <DialogContent className="flex h-[min(44rem,calc(100vh-4rem))] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{spec.title()}</DialogTitle>
          <DialogDescription>{session ? m.imports_review_hint() : spec.hint()}</DialogDescription>
        </DialogHeader>
        {session ? (
          <SessionView
            session={session}
            mode={request.mode}
            className="min-h-0 flex-1"
            onDone={(done) => onClose(done ? { session: done } : null)}
          />
        ) : sessionId ? null : (
          <SourcePicker request={request} onStarted={setSessionId} />
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Uploads the files one by one, then starts the session (ICS is parsed right away). */
async function createSession(request: ImportRequest, files: File[], text: string | null) {
  const uploadIds: string[] = []
  for (const file of files) {
    const { data } = await importsUploadCreate({ body: { file }, throwOnError: true })
    uploadIds.push(data.id)
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
    throwOnError: true,
  })
  return data
}

function SourcePicker({
  request,
  onStarted,
}: {
  request: ImportRequest
  onStarted: (sessionId: string) => void
}) {
  const inputId = useId()
  const queryClient = useQueryClient()
  const spec = SOURCES[request.source]
  const [files, setFiles] = useState<File[]>([])
  const [text, setText] = useState('')
  const [starting, setStarting] = useState(false)
  const ready = spec.accept ? files.length > 0 : text.trim().length > 0

  const start = () => {
    setStarting(true)
    createSession(request, files, spec.accept ? null : text).then(
      (session) => {
        storeSession(queryClient, session)
        onStarted(session.id)
      },
      (error: unknown) => {
        toastError(error)
        setStarting(false)
      },
    )
  }

  const startButton = (
    <Button disabled={!ready || starting} onClick={start}>
      {starting ? m.common_loading() : m.imports_start()}
    </Button>
  )

  return (
    <>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {spec.accept ? (
          <>
            {/* Dropping files on the picker is a shortcut; the file input inside is the control. */}
            {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
            <label
              htmlFor={inputId}
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed p-8 text-sm text-muted-foreground hover:bg-muted/50"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                const dropped = [...event.dataTransfer.files]
                setFiles((current) =>
                  spec.multiple ? [...current, ...dropped] : dropped.slice(0, 1),
                )
              }}
            >
              <FileUp aria-hidden className="size-6" />
              {spec.multiple ? m.imports_pick_files() : m.imports_pick_file()}
              <input
                id={inputId}
                type="file"
                className="sr-only"
                accept={spec.accept}
                multiple={spec.multiple}
                onChange={(event) => {
                  const picked = [...(event.target.files ?? [])]
                  setFiles((current) => (spec.multiple ? [...current, ...picked] : picked))
                  event.target.value = ''
                }}
              />
            </label>
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
          </>
        ) : (
          <Textarea
            aria-label={m.imports_source_text()}
            placeholder={m.imports_text_placeholder()}
            className="h-64 resize-none"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        )}
      </div>
      <DialogFooter>
        {spec.purpose ? <AiRequired purpose={spec.purpose}>{startButton}</AiRequired> : startButton}
      </DialogFooter>
    </>
  )
}
