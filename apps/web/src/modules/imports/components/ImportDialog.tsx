import type { ImportSession, ImportSessionDetail } from '@semestra/api-client'
import { importsSessionListOptions } from '@semestra/api-client/react-query'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog'
import { storeSession, useImportSession } from '../queries'
import { SOURCES } from '../sources'
import type { ImportOutcome, ImportRequest } from '../types'
import { ExtractionDone, SessionView } from './SessionView'
import { SourcePicker } from './SourcePicker'
import { isReading } from '../status'

/**
 * The unfinished import this request opened before (same source and target, still reading or
 * waiting for review): opening the dialog again resumes it instead of asking for the files again.
 * Not for a request that comes with its own files.
 */
function unfinished(request: ImportRequest, sessions: ImportSession[]): ImportSession | undefined {
  if (request.source === 'session' || request.source === 'picker' || request.fileItemIds?.length)
    return undefined
  const { target } = request
  const only = request.sourceMeta?.only ?? null
  return sessions.find(
    (s) =>
      (isReading(s) || s.status === 'ready') &&
      s.source_kind === request.source &&
      (s.source_meta.only ?? null) === only &&
      s.target.kind === target.kind &&
      (s.target.course_id ?? null) === (target.course_id ?? null) &&
      (s.target.term_id ?? null) === (target.term_id ?? null),
  )
}

/**
 * The import dialog an import source opens (M08 §6.2): pick the files (or paste text), then the
 * same session view as the session page. Started on a picker, its size is fixed from the first
 * step on, so nothing jumps when the review appears; opened on a review (Canvas assignments), it
 * is as tall as the review, up to the same height. Closing it keeps the import: a reading goes
 * on in the background, and the import history (or the task in the status bar) opens the review
 * again, and so does opening the same dialog again. Only "Discard" discards it.
 */
export function ImportDialog({
  request,
  onClose,
}: {
  request: ImportRequest
  onClose: (outcome: ImportOutcome) => void
}) {
  const queryClient = useQueryClient()
  const [sessionId, setSessionId] = useState<string | null>(
    request.source === 'session' ? request.sessionId : null,
  )
  const session = useImportSession(sessionId).data
  // File and text sources keep their picker (the "Read" progress) until extraction has finished.
  const [reviewing, setReviewing] = useState(false)
  // An unfinished import of the same source and target is resumed (fresh list: it may have been
  // started moments ago).
  const resumes = request.source !== 'session' && request.source !== 'picker'
  const sessions = useQuery({
    ...importsSessionListOptions({ path: { program_id: request.programId } }),
    enabled: resumes,
    refetchOnMount: 'always',
  })
  const [checked, setChecked] = useState(!resumes)
  if (!checked && (sessions.isFetchedAfterMount || sessions.isError)) {
    setChecked(true)
    const found = unfinished(request, sessions.data?.items ?? [])
    if (found) {
      setSessionId(found.id)
      setReviewing(true)
    }
  }
  const inPicker = request.source !== 'session' && request.source !== 'picker' && !reviewing
  // Other starts (Canvas, LMS) hand over an extracting session: show its check before the review.
  const [watched, setWatched] = useState(false)
  if (!inPicker && isReading(session) && !watched) setWatched(true)
  const finishing = !inPicker && watched && !reviewing && session && !isReading(session)
  const spec =
    request.source === 'picker'
      ? request.picker
      : request.source === 'session'
        ? { title: request.title, hint: null }
        : SOURCES[request.source]

  const started = (detail: ImportSessionDetail) => {
    storeSession(queryClient, detail)
    setSessionId(detail.id)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(null)}>
      <DialogContent
        className={cn(
          'flex flex-col sm:max-w-4xl',
          request.source === 'session'
            ? 'max-h-[min(44rem,calc(100vh-4rem))]'
            : 'h-[min(44rem,calc(100vh-4rem))]',
        )}
      >
        <DialogHeader>
          <DialogTitle>{'Title' in spec && spec.Title ? <spec.Title /> : spec.title()}</DialogTitle>
          {/* The review explains itself; the description is for picking what to read. */}
          {spec.hint && (inPicker || !session) ? (
            <DialogDescription>{spec.hint()}</DialogDescription>
          ) : null}
        </DialogHeader>
        {!checked ? null : inPicker ? (
          <SourcePicker
            request={request}
            session={session}
            onStarted={setSessionId}
            onFinished={() => setReviewing(true)}
          />
        ) : finishing ? (
          <ExtractionDone session={session} onFinished={() => setReviewing(true)} />
        ) : session ? (
          <SessionView
            session={session}
            mode={request.mode}
            className="min-h-0 flex-1"
            onDone={(done) => onClose(done ? { session: done } : null)}
          />
        ) : sessionId || request.source === 'session' ? null : request.source === 'picker' ? (
          <request.picker.component onStarted={started} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
