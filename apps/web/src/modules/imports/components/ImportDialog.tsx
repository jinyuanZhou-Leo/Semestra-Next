import { type ImportSessionDetail, importsSessionDiscard } from '@semestra/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { invalidateOperations } from '@/app/api'
import { AiGate } from '@/components/AiRequired'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog'
import { SOURCE_KIND_LABELS } from '../labels'
import { storeSession, useImportSession } from '../queries'
import { SOURCES } from '../sources'
import { isReading } from '../status'
import type { FileImportRequest, ImportOutcome, ImportRequest, ImportSourceKind } from '../types'
import { isUnfinished, matchesKey, requestKey, useUnfinishedImports } from '../unfinished'
import { CourseInfoReview } from './CourseInfoReview'
import { ExtractionDone, SessionView } from './SessionView'
import { SourcePicker } from './SourcePicker'

const FILE_SOURCES = new Set<string>(Object.keys(SOURCES))

/** The picker request a waiting file or text import was started from, to show it where it stands. */
function fileRequest(
  request: ImportRequest,
  session: ImportSessionDetail | undefined,
): FileImportRequest | null {
  if (request.source !== 'session' && request.source !== 'picker') return request
  if (!session || !FILE_SOURCES.has(session.source_kind) || session.source_meta.lms) return null
  if (session.source_meta.only === 'course_info') return null
  return {
    programId: session.program_id,
    mode: request.mode,
    source: session.source_kind as ImportSourceKind,
    target: session.target,
  }
}

/**
 * The import dialog (M08 §6.2): one straight path, choose → read → review → done, on one
 * surface. Every import is a session on the server, so the dialog only ever shows a session
 * where it stands: opening an entry point whose import is still reading or waiting for review
 * comes back to that step (the files being read, or the review), and so does the status line.
 * Closing never loses anything; only "Discard" ends an import. The height is fixed from the
 * first step on, so nothing moves when files are added or the review appears.
 */
export function ImportDialog({
  request,
  onClose,
}: {
  request: ImportRequest
  onClose: (outcome: ImportOutcome) => void
}) {
  const queryClient = useQueryClient()
  // An entry point with an import waiting opens it (the list is the one the entry point read).
  const unfinished = useUnfinishedImports(request.programId)
  const key = request.source === 'picker' ? (request.picker.resumes ?? null) : requestKey(request)
  const [sessionId, setSessionId] = useState<string | null>(
    request.source === 'session' ? request.sessionId : null,
  )
  const [resolved, setResolved] = useState(request.source === 'session' || key === null)
  // Picked up from the list rather than started or asked for by id.
  const [resumed, setResumed] = useState(false)
  if (!resolved && (unfinished.data || unfinished.isError)) {
    setResolved(true)
    const found = key && unfinished.data?.items.find((s) => matchesKey(s, key))
    if (found) {
      setSessionId(found.id)
      setResumed(true)
    }
  }
  const session = useImportSession(sessionId).data
  // The list can be a moment behind (discarded in another tab or by Sem): one that has ended
  // since is not picked up, and the entry starts afresh.
  if (resumed && session && !isUnfinished(session)) {
    setResumed(false)
    setSessionId(null)
  }
  const files = fileRequest(request, session)
  // File and text imports keep their picker (the "Read" progress) until the reading is done and
  // its check has shown; an import opened later on a finished reading goes straight to review.
  const [reviewing, setReviewing] = useState(false)
  const [watched, setWatched] = useState(false)
  if (session && isReading(session) && !watched) setWatched(true)
  const picking = files !== null && !reviewing && (!session || isReading(session) || watched)
  const finishing = !files && watched && !reviewing && session && !isReading(session)
  const courseInfo = session?.source_meta.only === 'course_info'

  const title =
    request.source === 'picker' ? (
      request.picker.Title ? (
        <request.picker.Title />
      ) : (
        request.picker.title()
      )
    ) : request.source === 'session' ? (
      (request.title?.() ?? (session ? sessionTitle(session) : ''))
    ) : (
      SOURCES[request.source].title()
    )
  const hint =
    request.source === 'picker'
      ? request.picker.hint()
      : files && picking
        ? SOURCES[files.source].hint()
        : courseInfo
          ? m.imports_review_hint()
          : null
  const purpose = files ? SOURCES[files.source].purpose : undefined

  // A failure stays waiting until the user has seen it; closing the dialog that shows it is that.
  const close = (outcome: ImportOutcome) => {
    if (session?.status === 'failed') {
      void importsSessionDiscard({ path: { session_id: session.id } }).then(() =>
        invalidateOperations(queryClient, ['importsSessionGet', 'importsSessionList']),
      )
    }
    onClose(outcome)
  }

  // The term wizard waits for the courses, so its imports are not sent to the background
  // (closing still keeps them, and the same source picks them up again).
  const background = request.mode === 'wizard' ? undefined : () => close(null)

  const started = (detail: ImportSessionDetail) => {
    storeSession(queryClient, detail)
    setResumed(false)
    setSessionId(detail.id)
  }

  let body = null
  if (!resolved || (sessionId && !session)) {
    body = null
  } else if (picking && files) {
    const picker = (
      <SourcePicker
        request={files}
        session={session}
        onStarted={(id) => {
          // Started here: its outcome (a failure too) is said where it was started.
          setWatched(true)
          setResumed(false)
          setSessionId(id)
        }}
        onFinished={() => setReviewing(true)}
        onBackground={background}
      />
    )
    // Asked before anything is picked or uploaded, by the one rule every entry shares; once an
    // import exists it says itself what went wrong. (One tree either way: the picker keeps its
    // files when the import starts.)
    body = <AiGate purpose={session ? undefined : purpose}>{picker}</AiGate>
  } else if (finishing) {
    body = <ExtractionDone session={session} onFinished={() => setReviewing(true)} />
  } else if (session && courseInfo && session.status === 'ready') {
    body = (
      <CourseInfoReview
        session={session}
        onDone={(done) => close(done ? { session: done } : null)}
      />
    )
  } else if (session) {
    body = (
      <SessionView
        session={session}
        mode={request.mode}
        className="min-h-0 flex-1"
        onBackground={background}
        onDone={(done) => close(done ? { session: done } : null)}
      />
    )
  } else if (request.source === 'picker') {
    body = <request.picker.component onStarted={started} />
  }

  return (
    <Dialog open onOpenChange={(open) => !open && close(null)}>
      <DialogContent
        className={cn(
          'flex flex-col',
          courseInfo
            ? 'max-h-[min(44rem,calc(100vh-4rem))] sm:max-w-lg'
            : 'h-[min(44rem,calc(100vh-4rem))] sm:max-w-4xl',
        )}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {/* The review explains itself; the description is for picking what to read. */}
          {hint ? <DialogDescription>{hint}</DialogDescription> : null}
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  )
}

function sessionTitle(session: ImportSessionDetail) {
  if (session.source_meta.only === 'course_info') return m.imports_course_info_review_title()
  return SOURCE_KIND_LABELS[session.source_kind]()
}
