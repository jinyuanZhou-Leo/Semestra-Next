import type { ImportSessionDetail } from '@semestra/api-client'
import {
  importsSessionCommitMutation,
  importsSessionDiscardMutation,
  importsSessionGetQueryKey,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, SearchX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { invalidateOperations } from '@/app/api'
import { AiAction } from '@/components/AiAction'
import { useProviderProblem } from '@/components/AiRequired'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useJob } from '@/hooks/use-job'
import { errorMessage, toastError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/ui/empty'
import { needsCheck } from '../labels'
import { readingProgress } from '../state'
import { settleEdits, storeSession } from '../queries'
import { SOURCES } from '../sources'
import type { ImportSourceKind } from '../types'
import { FileStatusList, sessionRows } from './FileStatusList'
import { ImportReview } from './ImportReview'
import { useWorthKeeping } from './worth-keeping'
import { isReading } from '../status'

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
function ExtractingAction({ session }: { session: ImportSessionDetail }) {
  const jobId = session.job_id
  const { progress, stageLabel, cancelling, cancel } = useJob(jobId)
  return (
    <AiAction
      state="running"
      label={m.imports_extracting()}
      progress={jobId ? readingProgress(session, progress) : undefined}
      stageLabel={
        session.status === 'waiting_files'
          ? m.imports_waiting_files()
          : stageLabel || m.imports_extracting()
      }
      cancelling={cancelling}
      className="w-60"
      onCancel={jobId ? cancel : undefined}
    />
  )
}

/**
 * One import session at any stage: extraction progress, the review with its actions, the result
 * of a commit (failed items can be fixed and retried), or why it failed, in the import dialog.
 *
 * `mode` `wizard` ends the review with "Add to wizard" instead of a commit (the term wizard
 * creates the courses, then commits the rest); `onDone` gets the session when the user finished,
 * null when they discarded it (it stays in the import history).
 */
export function SessionView({
  session,
  mode,
  onDone,
  onBackground,
  className,
}: {
  session: ImportSessionDetail
  mode: 'wizard' | 'direct'
  onDone: (session: ImportSessionDetail | null) => void
  /** Closes the dialog while the session is read; absent where the result has to come back. */
  onBackground?: () => void
  className?: string
}) {
  const queryClient = useQueryClient()
  // Set before the pending edits are awaited, so a second click cannot start a second commit.
  const [submitting, setSubmitting] = useState(false)
  const commit = useMutation({ ...importsSessionCommitMutation(), onError: toastError })
  const discard = useMutation({ ...importsSessionDiscardMutation(), onError: toastError })
  const keep = useWorthKeeping(session)
  const [confirming, setConfirming] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const failedCode =
    session.status === 'failed' ? (session.error_code ?? 'import.no_content') : null
  // A rejected key, no credit, unreachable: the way forward is the provider's settings.
  const provider = useProviderProblem(
    (session.source_kind in SOURCES
      ? SOURCES[session.source_kind as ImportSourceKind].purpose
      : undefined) ?? 'extraction',
    failedCode,
  )

  if (isReading(session)) {
    // Laid out like the first step: the files in the body, the progress where "Read" was.
    return (
      <div className={cn('flex min-h-0 flex-col gap-3', className)}>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <FileStatusList rows={sessionRows(session.source_refs)} />
        </div>
        <div className="flex items-center justify-end gap-2">
          {onBackground ? (
            <Button variant="ghost" className="mr-auto" onClick={onBackground}>
              {m.imports_continue_in_background()}
            </Button>
          ) : null}
          <ExtractingAction session={session} />
        </div>
      </div>
    )
  }

  // Discarding is the user's own choice and "already up to date" is a fine result: plain text.
  if (session.status === 'discarded' || session.status === 'up_to_date') {
    return (
      <p className={cn('text-sm text-muted-foreground', className)}>
        {session.status === 'discarded' ? m.imports_discarded() : m.imports_up_to_date()}
      </p>
    )
  }

  if (failedCode) {
    const reason = provider?.title ?? errorMessage({ error: { code: failedCode, params: {} } })
    // Nothing to review: the dialog's body says why, centered. Closing it is having seen it
    // (the import then ends); a provider's problem is fixed in its settings.
    return (
      <Empty className={className}>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchX aria-hidden />
          </EmptyMedia>
          <EmptyTitle>
            {failedCode === 'import.no_content'
              ? m.imports_failed_title()
              : m.imports_state_failed()}
          </EmptyTitle>
          <EmptyDescription>{reason}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row justify-center">
          <Button variant={provider ? 'outline' : 'default'} onClick={() => onDone(null)}>
            {m.common_close()}
          </Button>
          {provider ? (
            <Button
              onClick={() => {
                onDone(null)
                provider.fix()
              }}
            >
              {provider.action}
            </Button>
          ) : null}
        </EmptyContent>
      </Empty>
    )
  }

  const failedIds = session.items.filter((i) => i.result?.error_code).map((i) => i.id)
  const toWrite = session.items.filter(
    (i) => i.decision === 'accept' && !(i.result && !i.result.error_code),
  )
  const courses = toWrite.filter((i) => i.type === 'course').length
  const committed = session.status === 'committed'
  const wizardPending = session.target.kind === 'term_wizard' && !committed
  // Values read uncertainly and open issues: pointed at, never in the way (owner 2026-11-14).
  const toCheck = new Set(session.items.filter(needsCheck).map((item) => item.id))
  // The first one in the table's order, opened and scrolled to.
  const showNext = () => {
    const rows = document.querySelectorAll<HTMLElement>('[data-import-item]')
    const row = [...rows].find((el) => toCheck.has(el.dataset.importItem ?? ''))
    if (!row?.dataset.importItem) return
    setExpanded(row.dataset.importItem)
    row.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }
  // A file read with a caveat (e.g. cut short): one line each, in review and after the commit.
  const warnings = session.source_refs.flatMap((ref) =>
    ref.warning_code
      ? [
          errorMessage({
            error: {
              code: ref.warning_code,
              params: { filename: ref.filename ?? m.imports_file() },
            },
          }),
        ]
      : [],
  )

  const runCommit = async (itemIds?: string[]) => {
    if (submitting) return
    setSubmitting(true)
    const body = itemIds ? { item_ids: itemIds } : {}
    await settleEdits()
    try {
      const result = await commit.mutateAsync({ path: { session_id: session.id }, body })
      storeSession(queryClient, result.session)
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
          onDone(null)
        },
      },
    )

  return (
    <div className={cn('flex min-h-0 flex-col gap-3', className)}>
      {warnings.map((warning) => (
        <p key={warning} className="text-sm text-muted-foreground">
          {warning}
        </p>
      ))}
      <ImportReview
        session={session}
        expanded={expanded}
        onExpandedChange={setExpanded}
        className="min-h-0 flex-1"
      />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {committed ? (
          <>
            <p
              className={cn(
                'mr-auto text-sm',
                failedIds.length > 0 ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {failedIds.length > 0
                ? m.imports_result_failed({ count: failedIds.length })
                : m.imports_result_done({
                    created: session.summary.created ?? 0,
                    updated: session.summary.updated ?? 0,
                  })}
            </p>
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
            <Button
              variant="destructive"
              className="mr-auto"
              disabled={discard.isPending}
              onClick={() => (keep ? setConfirming(true) : runDiscard())}
            >
              {m.imports_discard()}
            </Button>
            <ConfirmDialog
              open={confirming}
              onOpenChange={setConfirming}
              title={m.imports_discard_title()}
              description={m.imports_discard_description()}
              confirmLabel={m.imports_discard()}
              pending={discard.isPending}
              onConfirm={runDiscard}
            />
            {toCheck.size > 0 && !committed ? (
              <Button variant="link" className="px-1 text-warning" onClick={showNext}>
                {m.imports_needs_check({ count: toCheck.size })}
                <ArrowDown aria-hidden />
              </Button>
            ) : null}
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
    </div>
  )
}
