import type { ImportSessionDetail } from '@semestra/api-client'
import {
  importsSessionCommitMutation,
  importsSessionDiscardMutation,
  importsSessionGetQueryKey,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { invalidateOperations } from '@/app/api'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { AiAction } from '@/components/AiAction'
import { useJob } from '@/hooks/use-job'
import { errorMessage, toastError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/ui/alert'
import { issueSummary } from '../labels'
import { invalidateAfterCommit, settleEdits, storeSession } from '../queries'
import { FileStatusList, sessionRows } from './FileStatusList'
import { ImportReview } from './ImportReview'

/** How long the finished check shows before the review replaces the extraction. */
export const SUCCESS_HOLD_MS = 1000

/**
 * What follows an extraction the user watched (a Canvas or LMS import that started elsewhere): the
 * check on the action for a moment, then `onFinished` opens the review. A failed or discarded
 * session goes straight on, since the session view explains it.
 */
export function ExtractionDone({
  session,
  onFinished,
}: {
  session: ImportSessionDetail
  onFinished: () => void
}) {
  const ended = session.status === 'failed' || session.status === 'discarded'
  useEffect(() => {
    const timer = window.setTimeout(onFinished, ended ? 0 : SUCCESS_HOLD_MS)
    return () => window.clearTimeout(timer)
  }, [ended, onFinished])
  return (
    <div className="space-y-4">
      <AiAction state={ended ? 'idle' : 'success'} label={m.imports_extracting()} />
      <FileStatusList rows={sessionRows(session.source_refs)} />
    </div>
  )
}

/** The running extraction as a button-shaped progress bar; its stop button cancels the job. */
function ExtractingAction({ jobId }: { jobId: string | null | undefined }) {
  const { progress, stageLabel, cancelling, cancel } = useJob(jobId)
  return (
    <AiAction
      state="running"
      label={m.imports_extracting()}
      progress={jobId ? progress : undefined}
      stageLabel={stageLabel || m.imports_extracting()}
      cancelling={cancelling}
      onCancel={jobId ? cancel : undefined}
    />
  )
}

/**
 * One import session at any stage: extraction progress, the review with its actions, the result
 * of a commit (failed items can be fixed and retried), or why it failed. Used by the import
 * dialog and the session page.
 *
 * `mode` `wizard` ends the review with "Add to wizard" instead of a commit (the term wizard
 * creates the courses, then commits the rest); `onDone` gets the session when the user finished,
 * null when they discarded it or left for later.
 */
export function SessionView({
  session,
  mode,
  onDone,
  className,
}: {
  session: ImportSessionDetail
  mode: 'wizard' | 'direct'
  onDone: (session: ImportSessionDetail | null) => void
  className?: string
}) {
  const queryClient = useQueryClient()
  const [discarding, setDiscarding] = useState(false)
  // Set before the pending edits are awaited, so a second click cannot start a second commit.
  const [submitting, setSubmitting] = useState(false)
  const commit = useMutation({ ...importsSessionCommitMutation(), onError: toastError })
  const discard = useMutation({ ...importsSessionDiscardMutation(), onError: toastError })

  if (session.status === 'extracting') {
    return (
      <div className={cn('space-y-4', className)}>
        <ExtractingAction jobId={session.job_id} />
        <FileStatusList rows={sessionRows(session.source_refs)} />
      </div>
    )
  }

  // Discarding is the user's own choice and "already up to date" is a fine result: plain text.
  if (session.status === 'discarded' || session.error_code === 'import.no_changes') {
    return (
      <p className={cn('text-sm text-muted-foreground', className)}>
        {session.status === 'discarded' ? m.imports_discarded() : m.imports_up_to_date()}
      </p>
    )
  }

  if (session.status === 'failed') {
    const reason = errorMessage({
      error: { code: session.error_code ?? 'import.no_content', params: {} },
    })
    return (
      <Alert variant="destructive" className={className}>
        <CircleAlert aria-hidden />
        <AlertTitle>{m.imports_failed_title()}</AlertTitle>
        <AlertDescription>{reason}</AlertDescription>
      </Alert>
    )
  }

  const failedIds = session.items.filter((i) => i.result?.error_code).map((i) => i.id)
  const toWrite = session.items.filter(
    (i) => i.decision === 'accept' && !(i.result && !i.result.error_code),
  )
  const courses = toWrite.filter((i) => i.type === 'course').length
  const committed = session.status === 'committed'
  const wizardPending = session.target.kind === 'term_wizard' && !committed
  const issues = issueSummary(session)

  const runCommit = async (itemIds?: string[]) => {
    if (submitting) return
    setSubmitting(true)
    const body = itemIds ? { item_ids: itemIds } : {}
    await settleEdits()
    try {
      const result = await commit.mutateAsync({ path: { session_id: session.id }, body })
      storeSession(queryClient, result.session)
      await invalidateAfterCommit(queryClient)
      if (result.failed > 0) {
        toast.error(m.imports_commit_partial({ failed: result.failed }))
      } else {
        toast.success(m.imports_committed({ created: result.created, updated: result.updated }))
        onDone(result.session)
      }
    } catch {
      // toastError already showed it
    }
    setSubmitting(false)
  }
  // The wizard takes the courses as they are once the last edits are saved.
  const addToWizard = async () => {
    await settleEdits()
    const key = importsSessionGetQueryKey({ path: { session_id: session.id } })
    onDone(queryClient.getQueryData<ImportSessionDetail>(key) ?? session)
  }
  const runDiscard = () =>
    discard.mutate(
      { path: { session_id: session.id } },
      {
        onSuccess: () => {
          void invalidateOperations(queryClient, ['importsSessionGet', 'importsSessionList'])
          setDiscarding(false)
          onDone(null)
        },
      },
    )

  return (
    <div className={cn('flex min-h-0 flex-col gap-3', className)}>
      <p
        className={cn(
          'min-h-5 text-sm',
          (!committed && issues) || failedIds.length > 0
            ? 'text-destructive'
            : 'text-muted-foreground',
        )}
      >
        {committed
          ? failedIds.length > 0
            ? m.imports_result_failed({ count: failedIds.length })
            : m.imports_result_done({
                created: session.summary.created ?? 0,
                updated: session.summary.updated ?? 0,
              })
          : (issues ?? m.imports_no_issues())}
      </p>
      <ImportReview session={session} className="min-h-0 flex-1" />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {committed ? (
          <>
            <Button variant="ghost" onClick={() => onDone(session)}>
              {m.common_close()}
            </Button>
            {failedIds.length > 0 ? (
              <Button disabled={submitting} onClick={() => void runCommit(failedIds)}>
                {m.imports_retry_failed({ count: failedIds.length })}
              </Button>
            ) : null}
          </>
        ) : (
          <>
            <Button variant="destructive" className="mr-auto" onClick={() => setDiscarding(true)}>
              {m.imports_discard()}
            </Button>
            <Button variant="ghost" onClick={() => onDone(null)}>
              {m.imports_later()}
            </Button>
            {mode === 'wizard' ? (
              <Button disabled={courses === 0} onClick={() => void addToWizard()}>
                {m.imports_add_to_wizard({ count: courses })}
              </Button>
            ) : wizardPending ? null : (
              <Button
                disabled={toWrite.length === 0 || submitting}
                onClick={() => void runCommit()}
              >
                {submitting ? m.common_loading() : m.imports_commit({ count: toWrite.length })}
              </Button>
            )}
          </>
        )}
      </div>
      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title={m.imports_discard_title()}
        description={m.imports_discard_description()}
        confirmLabel={m.imports_discard()}
        pending={discard.isPending}
        onConfirm={runDiscard}
      />
    </div>
  )
}
