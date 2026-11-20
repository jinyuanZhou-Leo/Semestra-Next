import type { SyncItem, SyncStatus } from '@semestra/api-client'
import { lmsSyncRequestMutation, lmsSyncStatusQueryKey } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, RefreshCw, Settings2 } from 'lucide-react'
import { useSettingsDialog } from '@/app/settings/use-settings-dialog'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { PanelIconAction } from '@/components/StatusPanel'
import { useNow } from '@/hooks/use-now'
import { useDialogTarget } from '@/lib/dialog-target'
import { errorMessage, toastError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { courseColor } from '@/modules/academics/color'
import { useCourses } from '@/modules/academics/queries'
import { m } from '@/paraglide/messages'
import { Alert, AlertDescription, AlertTitle } from '@/ui/alert'
import { Button } from '@/ui/button'
import { PopoverDescription, PopoverHeader, PopoverTitle } from '@/ui/popover'
import { Progress } from '@/ui/progress'
import { Spinner } from '@/ui/spinner'
import { importAssignments } from '../import/assignments'
import { CONNECTION_ERROR_LABEL } from '../labels'
import { useSyncAnswers } from './answers'
import { byCourse } from './labels'
import { MoreSections } from './MoreSections'
import { PendingSection } from './PendingSection'
import { RecentSection } from './RecentSection'
import type { CourseOf } from './rows'
import { syncedAgo, useProgramId, useSync } from './status'

/**
 * The panel of the LMS status line (M09 §4.1). The header (platform, last sync, "Sync now")
 * stays put while the rest scrolls: what waits for the user (new assignments, values both sides
 * changed, items deleted on the platform), what the sync changed lately (each assignment change
 * can be put back, and that undone; course materials that came, changed or went open from here),
 * the fields the user set apart from the platform (each can take the platform's value again), the
 * ignored new items and the materials the user removed (each can be restored), every list grouped
 * by course.
 */
export default function SyncPanel({ onClose }: { onClose: () => void }) {
  const programId = useProgramId()
  const { status, provider } = useSync(programId)
  if (!programId || !status || !provider) return <Spinner className="mx-auto" />
  return <Panel programId={programId} status={status} provider={provider} onClose={onClose} />
}

function Panel({
  programId,
  status,
  provider,
  onClose,
}: {
  programId: string
  status: SyncStatus
  provider: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const settings = useSettingsDialog()
  const now = useNow()
  const deleting = useDialogTarget<SyncItem>()
  const answers = useSyncAnswers(programId)
  const colors = new Map(
    (useCourses(programId).data?.items ?? []).map((course) => [course.id, courseColor(course)]),
  )
  const request = useMutation({
    ...lmsSyncRequestMutation(),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: lmsSyncStatusQueryKey({ path: { program_id: programId } }),
      }),
    onError: toastError,
  })
  const importItems = async (items: SyncItem[]) => {
    onClose()
    for (const group of byCourse(items)) {
      try {
        await importAssignments(
          group.courseId,
          group.items.map((i) => i.external_id),
          provider,
        )
      } catch (error) {
        toastError(error)
        return
      }
    }
  }
  const openSettings = () => {
    onClose()
    settings.open({ level: 'account', group: 'lms' })
  }

  const syncing = status.syncing || request.isPending
  const broken = status.connection_error
    ? errorMessage({ error: { code: status.connection_error } })
    : null
  // How far a sync the user asked for is; the background's own shows no count.
  const shownRound = syncing ? (status.round ?? null) : null
  const headline = broken
    ? broken
    : shownRound
      ? m.lms_sync_panel_progress({ done: shownRound.done, total: shownRound.total })
      : syncing
        ? m.lms_sync_panel_syncing()
        : status.synced_at
          ? m.lms_sync_panel_synced({ ago: syncedAgo(status.synced_at, now) })
          : m.lms_sync_meta_waiting()
  const course: CourseOf = (id, code) => ({ course: code, color: colors.get(id) })
  const shared = { provider, answers, course }

  return (
    <div className="-m-4 flex max-h-[min(36rem,75vh)] flex-col">
      <div className="relative flex items-center gap-3 border-b py-3 pr-2.5 pl-4">
        <PopoverHeader className="min-w-0 flex-1 gap-0">
          <PopoverTitle className="truncate text-sm">{provider}</PopoverTitle>
          <PopoverDescription className={cn('text-xs tabular-nums', broken && 'text-destructive')}>
            {headline}
          </PopoverDescription>
        </PopoverHeader>
        {broken ? (
          <Button size="sm" onClick={openSettings}>
            {m.lms_sync_reconnect()}
          </Button>
        ) : (
          <div className="flex items-center gap-0.5">
            <PanelIconAction
              label={m.lms_sync_now()}
              disabled={syncing}
              onClick={() =>
                request.mutate({ path: { program_id: programId }, body: { force: true } })
              }
            >
              <RefreshCw aria-hidden className={cn(syncing && 'animate-spin')} />
            </PanelIconAction>
            <PanelIconAction label={m.lms_sync_panel_settings()} onClick={openSettings}>
              <Settings2 aria-hidden />
            </PanelIconAction>
          </div>
        )}
        {shownRound ? (
          <Progress
            value={(shownRound.done / shownRound.total) * 100}
            aria-label={headline}
            className="absolute inset-x-0 -bottom-px [&_[data-slot=progress-track]]:h-0.5 [&_[data-slot=progress-track]]:rounded-none"
          />
        ) : null}
      </div>

      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-2 pb-3">
        {status.errors.length > 0 && !status.connection_error ? (
          <Alert variant="destructive" className="mx-2 mt-1 w-auto px-3 py-2 text-xs">
            <CircleAlert aria-hidden />
            <AlertTitle className="text-xs">
              {m.lms_sync_panel_failed({
                courses: [...new Set(status.errors.map((e) => e.course))].join(
                  m.lms_sync_list_separator(),
                ),
              })}
            </AlertTitle>
            <AlertDescription className="text-xs">
              {[
                ...new Set(
                  status.errors.map(
                    (e) =>
                      CONNECTION_ERROR_LABEL[e.code]?.() ??
                      errorMessage({ error: { code: e.code } }),
                  ),
                ),
              ].join(' ')}
            </AlertDescription>
          </Alert>
        ) : null}
        <PendingSection
          {...shared}
          pending={status.pending}
          broken={Boolean(broken)}
          onImport={(items) => void importItems(items)}
          onDelete={deleting.show}
          onClose={onClose}
        />
        <RecentSection
          {...shared}
          programId={programId}
          changes={status.recent}
          materials={status.materials}
          now={now}
          onClose={onClose}
        />
        <MoreSections
          {...shared}
          status={status}
          broken={Boolean(broken)}
          now={now}
          onImport={(items) => void importItems(items)}
        />
      </div>

      <ConfirmDialog
        {...deleting.props}
        title={m.lms_sync_delete_title({ title: deleting.target?.title ?? '' })}
        description={m.lms_sync_delete_description({ provider })}
        confirmLabel={m.lms_sync_delete()}
        onConfirm={() => {
          if (deleting.target) answers.settle(deleting.target, 'delete')
          deleting.close()
        }}
      />
    </div>
  )
}
