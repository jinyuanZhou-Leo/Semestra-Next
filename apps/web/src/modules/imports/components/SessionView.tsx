import type { ImportSessionDetail } from '@semestra/api-client'
import {
  importsSessionCommitMutation,
  importsSessionDiscardMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, FileText } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { invalidateOperations } from '@/app/api'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { JobProgress } from '@/components/JobProgress'
import { errorMessage, toastError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/ui/alert'
import { Spinner } from '@/ui/spinner'
import { issueSummary } from '../labels'
import { invalidateAfterCommit, storeSession } from '../queries'
import { ImportReview } from './ImportReview'

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
  const commit = useMutation({ ...importsSessionCommitMutation(), onError: toastError })
  const discard = useMutation({ ...importsSessionDiscardMutation(), onError: toastError })

  if (session.status === 'extracting') {
    return (
      <div className={cn('space-y-4', className)}>
        <p className="text-sm text-muted-foreground">{m.imports_extracting()}</p>
        {session.job_id ? <JobProgress jobId={session.job_id} /> : <Spinner />}
        <ul className="space-y-1 text-sm">
          {session.source_refs.map((ref, index) => (
            <li
              key={ref.upload_id ?? ref.file_item_id ?? index}
              className="flex items-center gap-2"
            >
              <FileText aria-hidden className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{ref.filename ?? m.imports_file()}</span>
              <span className="text-xs text-muted-foreground">
                {ref.status === 'done'
                  ? m.imports_file_done()
                  : ref.status === 'failed'
                    ? m.imports_file_failed()
                    : ref.status === 'extracting'
                      ? m.imports_file_extracting()
                      : m.imports_file_pending()}
              </span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  if (session.status === 'failed' || session.status === 'discarded') {
    const reason =
      session.status === 'discarded'
        ? m.imports_discarded()
        : errorMessage({ error: { code: session.error_code ?? 'import.no_content', params: {} } })
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
    const body = itemIds ? { item_ids: itemIds } : {}
    try {
      const result = await commit.mutateAsync({ path: { session_id: session.id }, body })
      storeSession(queryClient, result.session)
      await invalidateAfterCommit(queryClient)
      if (result.failed > 0) {
        toast.error(m.imports_commit_partial({ failed: result.failed }))
        return
      }
      toast.success(m.imports_committed({ created: result.created, updated: result.updated }))
      onDone(result.session)
    } catch {
      // toastError already showed it
    }
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
              <Button disabled={commit.isPending} onClick={() => void runCommit(failedIds)}>
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
              <Button disabled={courses === 0} onClick={() => onDone(session)}>
                {m.imports_add_to_wizard({ count: courses })}
              </Button>
            ) : wizardPending ? null : (
              <Button
                disabled={toWrite.length === 0 || commit.isPending}
                onClick={() => void runCommit()}
              >
                {commit.isPending
                  ? m.common_loading()
                  : m.imports_commit({ count: toWrite.length })}
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
