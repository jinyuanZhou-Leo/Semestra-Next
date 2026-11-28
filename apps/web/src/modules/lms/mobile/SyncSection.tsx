import type { SyncConflict, SyncItem, SyncStatus } from '@semestra/api-client'
import { lmsSyncRequestMutation, lmsSyncStatusQueryKey } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, CircleAlert, CircleCheck, RefreshCw, School } from 'lucide-react'
import { useState } from 'react'
import { MobileList, MobileSection } from '@/app/mobile/MobilePage'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useNow } from '@/hooks/use-now'
import { useDialogTarget } from '@/lib/dialog-target'
import { errorMessage, toastError } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { courseColor } from '@/modules/academics/color'
import { useCourses } from '@/modules/academics/queries'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/ui/drawer'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { importAssignments } from '../import/assignments'
import { useSyncAnswers } from '../sync/answers'
import { byCourse, fieldLabel, pendingCount } from '../sync/labels'
import { Values } from '../sync/rows'
import { hasSyncLine, syncedAgo, useSync } from '../sync/status'

/**
 * The LMS sync over the phone's course list (M17 §4.2), in place of the desktop's status line:
 * one row with the platform and when it last synced, or how many things wait for the user. It
 * opens what waits (new assignments to import or ignore, assignments deleted on the platform,
 * values both sides changed), answered the same way as in the desktop panel.
 */
export default function SyncSection({
  programId,
}: {
  programId: string
  termId: string | undefined
}) {
  const { status, provider } = useSync(programId)
  const now = useNow()
  const [open, setOpen] = useState(false)
  if (!hasSyncLine(status) || !provider) return null
  const pending = pendingCount(status.pending)
  const broken = Boolean(status.connection_error)
  const meta = broken
    ? m.lms_sync_meta_reconnect()
    : pending > 0
      ? m.mobile_sync_pending({ count: pending })
      : status.syncing
        ? m.lms_sync_panel_syncing()
        : status.synced_at
          ? m.lms_sync_panel_synced({ ago: syncedAgo(status.synced_at, now) })
          : m.lms_sync_meta_waiting()
  return (
    <MobileSection title={m.mobile_sync_title()}>
      <MobileList>
        <li>
          <button
            type="button"
            className="flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left"
            onClick={() => setOpen(true)}
          >
            {broken ? (
              <CircleAlert aria-hidden className="size-5 text-destructive" />
            ) : (
              <School aria-hidden className="size-5 text-muted-foreground" />
            )}
            <span className="flex-1 font-medium">{provider}</span>
            <span
              className={cn(
                'text-sm',
                broken
                  ? 'text-destructive'
                  : pending > 0
                    ? 'font-medium text-primary'
                    : 'text-muted-foreground',
              )}
            >
              {meta}
            </span>
            <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
          </button>
        </li>
      </MobileList>
      <Drawer open={open} onOpenChange={setOpen} showSwipeHandle>
        <DrawerContent className="max-h-[92dvh]">
          <Pending programId={programId} status={status} provider={provider} meta={meta} />
        </DrawerContent>
      </Drawer>
    </MobileSection>
  )
}

// The drawer centres its header; the rows under it are left-aligned, so the header is too.
const HEADER = 'flex-row items-center gap-3 pb-3 group-data-[swipe-axis=y]/drawer-popup:text-left'

function Pending({
  programId,
  status,
  provider,
  meta,
}: {
  programId: string
  status: SyncStatus
  provider: string
  meta: string
}) {
  const queryClient = useQueryClient()
  const answers = useSyncAnswers(programId)
  const deleting = useDialogTarget<SyncItem>()
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
  const broken = status.connection_error
    ? errorMessage({ error: { code: status.connection_error } })
    : null
  const syncing = status.syncing || request.isPending
  const importItems = async (items: SyncItem[]) => {
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
  const { busy, leaving } = answers
  const rows = status.pending.flatMap(
    (item): { item: SyncItem; conflict: SyncConflict | null; key: string }[] =>
      item.kind === 'conflict'
        ? (item.conflicts ?? []).map((conflict) => ({
            item,
            conflict,
            key: `${item.id}:${conflict.field}`,
          }))
        : [{ item, conflict: null, key: item.id }],
  )
  return (
    <>
      <DrawerHeader className={HEADER}>
        <div className="grid min-w-0 flex-1">
          <DrawerTitle className="truncate">{provider}</DrawerTitle>
          <DrawerDescription className={cn('truncate', broken && 'text-destructive')}>
            {broken ?? meta}
          </DrawerDescription>
        </div>
        {broken ? null : (
          <Button
            variant="outline"
            size="sm"
            disabled={syncing}
            onClick={() =>
              request.mutate({ path: { program_id: programId }, body: { force: true } })
            }
          >
            <RefreshCw aria-hidden className={cn(syncing && 'animate-spin')} />
            {m.lms_sync_now()}
          </Button>
        )}
      </DrawerHeader>
      <div className="flex min-h-0 flex-col overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
        {rows.length === 0 ? (
          <Empty className="rounded-2xl border border-solid border-border p-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CircleCheck aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{m.mobile_sync_nothing()}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <MobileList label={m.lms_sync_pending()}>
            {rows.map(({ item, conflict, key }) => (
              <li
                key={key}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 transition-opacity',
                  leaving(key) && 'opacity-0',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 font-medium">
                    {conflict
                      ? m.lms_sync_change({ title: item.title, field: fieldLabel(conflict.field) })
                      : item.title}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: colors.get(item.course_id) }}
                    />
                    <span>{item.course}</span>
                    <span aria-hidden>·</span>
                    <span className="truncate">
                      {conflict ? (
                        <Values
                          field={conflict.field}
                          from={conflict.mine}
                          to={conflict.platform}
                        />
                      ) : item.kind === 'removed' ? (
                        m.lms_sync_removed({ provider })
                      ) : item.due_at ? (
                        m.lms_sync_panel_new_due({ due: formatDate(item.due_at, { short: true }) })
                      ) : (
                        m.lms_sync_kind_new()
                      )}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {conflict ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => answers.resolveField(item.id, conflict.field, 'mine')}
                      >
                        {m.lms_sync_keep()}
                      </Button>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => answers.resolveField(item.id, conflict.field, 'platform')}
                      >
                        {m.lms_sync_update()}
                      </Button>
                    </>
                  ) : item.kind === 'removed' ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => answers.settle(item, 'keep')}
                      >
                        {m.lms_sync_keep()}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={busy}
                        onClick={() => deleting.show(item)}
                      >
                        {m.lms_sync_delete()}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => answers.setDismissed([item], true)}
                      >
                        {m.lms_sync_ignore()}
                      </Button>
                      <Button
                        size="sm"
                        disabled={Boolean(broken)}
                        onClick={() => void importItems([item])}
                      >
                        {m.lms_sync_import()}
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </MobileList>
        )}
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
    </>
  )
}
