import { type ImportSessionDetail, importsSessionDiscard } from '@semestra/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { invalidateOperations } from '@/app/api'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog'
import { invalidateAfterCommit, storeSession, useImportSession } from '../queries'
import { SOURCES } from '../sources'
import type { ImportOutcome, ImportRequest } from '../types'
import { ExtractionDone, SessionView } from './SessionView'
import { SourcePicker } from './SourcePicker'

/** What a commit saved, without the categories that came with the assessments. */
function savedCount(session: ImportSessionDetail): number {
  return session.items.filter(
    (i) => i.type !== 'category' && i.result != null && !i.result.error_code,
  ).length
}

/**
 * The import dialog an import source opens (M08 §6.2): pick the files (or paste text), then the
 * same session view as the session page. Its size is fixed from the first step on, so nothing
 * jumps when the review appears. Closing it before the import is saved discards the import (it
 * stays in the import history); a click outside does not close it once there is one.
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
  const inPicker = request.source !== 'session' && request.source !== 'picker' && !reviewing
  // Other starts (Canvas, LMS) hand over an extracting session: show its check before the review.
  const [watched, setWatched] = useState(false)
  if (!inPicker && session?.status === 'extracting' && !watched) setWatched(true)
  const finishing = !inPicker && watched && !reviewing && session && session.status !== 'extracting'
  const spec =
    request.source === 'picker'
      ? request.picker
      : request.source === 'session'
        ? { title: request.title, hint: m.imports_review_hint }
        : SOURCES[request.source]

  const close = () => {
    const open = sessionId && (session?.status === 'ready' || session?.status === 'extracting')
    onClose(null)
    if (!open) return
    importsSessionDiscard({ path: { session_id: sessionId }, throwOnError: true })
      .then(() => invalidateOperations(queryClient, ['importsSessionGet', 'importsSessionList']))
      .catch(toastError)
  }
  // A picker's import that needed no decision was saved at once: nothing to review.
  const started = async (detail: ImportSessionDetail) => {
    storeSession(queryClient, detail)
    if (detail.status !== 'committed' || detail.summary.failed) {
      setSessionId(detail.id)
      return
    }
    onClose({ session: detail })
    toast.success(m.imports_saved({ count: savedCount(detail) }))
    await invalidateAfterCommit(queryClient)
  }

  return (
    <Dialog
      open
      disablePointerDismissal={sessionId !== null}
      onOpenChange={(open) => !open && close()}
    >
      <DialogContent className="flex h-[min(44rem,calc(100vh-4rem))] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{'Title' in spec && spec.Title ? <spec.Title /> : spec.title()}</DialogTitle>
          <DialogDescription>
            {session && !inPicker ? m.imports_review_hint() : spec.hint()}
          </DialogDescription>
        </DialogHeader>
        {inPicker ? (
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
          <request.picker.component onStarted={(detail) => void started(detail)} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
