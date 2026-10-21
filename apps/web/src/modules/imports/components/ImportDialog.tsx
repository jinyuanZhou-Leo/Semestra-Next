import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { m } from '@/paraglide/messages'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog'
import { storeSession, useImportSession } from '../queries'
import { SOURCES } from '../sources'
import type { ImportOutcome, ImportRequest } from '../types'
import { ExtractionDone, SessionView } from './SessionView'
import { SourcePicker } from './SourcePicker'

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

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(null)}>
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
          <request.picker.component
            onStarted={(started) => {
              storeSession(queryClient, started)
              setSessionId(started.id)
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
