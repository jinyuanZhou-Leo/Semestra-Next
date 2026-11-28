import type { SyncItem, SyncStatus } from '@semestra/api-client'
import { lmsSyncRequestMutation, lmsSyncStatusQueryKey } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, CircleAlert, CircleCheck, RefreshCw, School } from 'lucide-react'
import { useState } from 'react'
import { MobileList, MobileSection } from '@/app/mobile/MobilePage'
import { useSettingsDialog } from '@/app/settings/use-settings-dialog'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useNow } from '@/hooks/use-now'
import { useDialogTarget } from '@/lib/dialog-target'
import { toastError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { courseColor } from '@/modules/academics/color'
import { useCourses } from '@/modules/academics/queries'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/ui/drawer'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { useAssignmentDetails } from '../assignment/target'
import { type SyncAnswers, useSyncAnswers } from '../sync/answers'
import { CalendarLines } from '../sync/CalendarNote'
import { pendingCount } from '../sync/labels'
import { ignoredRows, pendingRows, type SyncRow } from '../sync/pending-rows'
import { ProblemList } from '../sync/ProblemList'
import type { CourseOf } from '../sync/rows'
import { hasSyncLine, syncedPartly, syncHeadline, useSync } from '../sync/status'
import { UnreadableList } from '../sync/UnreadableList'

/**
 * The LMS sync over the phone's course list (M17 §4.2), in place of the desktop's status line:
 * one row with the platform and when it last synced (partly, when something did not sync), how
 * many things wait for the user, or that the connection needs reconnecting. It opens the sheet.
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
      : syncHeadline(status, now, status.syncing)
  const partly = !broken && pending === 0 && syncedPartly(status)
  return (
    <MobileSection title={m.mobile_sync_title()}>
      <MobileList>
        <li>
          <button
            type="button"
            className="flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left"
            onClick={() => setOpen(true)}
          >
            {broken || partly ? (
              <CircleAlert
                aria-hidden
                className={cn('size-5', broken ? 'text-destructive' : 'text-warning')}
              />
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
          <Sheet
            programId={programId}
            status={status}
            provider={provider}
            onClose={() => setOpen(false)}
          />
        </DrawerContent>
      </Drawer>
    </MobileSection>
  )
}

// The drawer centres its header; the rows under it are left-aligned, so the header is too.
const HEADER = 'flex-row items-center gap-3 pb-3 group-data-[swipe-axis=y]/drawer-popup:text-left'

/** How the sheet draws a row's answers (`RowAction.tone`). */
const VARIANT = { quiet: 'ghost', main: 'default', danger: 'destructive' } as const

/**
 * The sheet: "Sync now" (or "Reconnect"), what did not sync, then the questions of the desktop
 * panel (`pendingRows`), the parts not updated and the ignored items. A row opens the
 * assignment's details. New assignments are imported on a computer, where the import is
 * reviewed; here they can be ignored, or asked about again once ignored.
 */
function Sheet({
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
  const details = useAssignmentDetails()
  const now = useNow()
  const answers = useSyncAnswers(programId)
  const deleting = useDialogTarget<SyncItem>()
  const colors = new Map(
    (useCourses(programId).data?.items ?? []).map((course) => [course.id, courseColor(course)]),
  )
  const course: CourseOf = (id, code) => ({ course: code, color: colors.get(id) })
  const request = useMutation({
    ...lmsSyncRequestMutation(),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: lmsSyncStatusQueryKey({ path: { program_id: programId } }),
      }),
    onError: toastError,
  })
  const broken = Boolean(status.connection_error)
  const syncing = status.syncing || request.isPending
  const context = { provider, answers, broken, onDelete: deleting.show }
  const pending = pendingRows(status.pending, context)
  const ignored = ignoredRows(status.ignored, context)
  const anyNew = status.pending.some((item) => item.kind === 'new')
  const open = (item: SyncItem) => {
    onClose()
    details.open(item.course_id, item.external_id)
  }
  const nothing =
    pending.length === 0 &&
    ignored.length === 0 &&
    status.problems.length === 0 &&
    status.unreadable.length === 0
  return (
    <>
      <DrawerHeader className={HEADER}>
        <div className="grid min-w-0 flex-1">
          <DrawerTitle className="truncate">{provider}</DrawerTitle>
          <DrawerDescription className={cn('truncate', broken && 'text-destructive')}>
            {syncHeadline(status, now, syncing)}
          </DrawerDescription>
        </div>
        {broken ? (
          <Button
            size="sm"
            onClick={() => {
              onClose()
              settings.open({ level: 'account', group: 'lms' })
            }}
          >
            {m.lms_sync_reconnect()}
          </Button>
        ) : (
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
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
        {broken ? null : (
          <div className="flex flex-col empty:hidden">
            <ProblemList problems={status.problems} course={course} />
            <CalendarLines status={status} unreadable={false} className="px-2 pt-1" />
          </div>
        )}
        {nothing ? (
          <Empty className="rounded-2xl border border-solid border-border p-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CircleCheck aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{m.mobile_sync_nothing()}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : null}
        {pending.length > 0 ? (
          <Rows
            label={m.lms_sync_pending()}
            rows={pending}
            answers={answers}
            colors={colors}
            onOpen={open}
            note={anyNew ? m.mobile_sync_import_on_computer() : undefined}
          />
        ) : null}
        <div className="flex flex-col empty:hidden">
          <UnreadableList
            programId={programId}
            unreadable={status.unreadable}
            provider={provider}
            now={now}
            answers={answers}
            course={course}
            onClose={onClose}
          />
        </div>
        {ignored.length > 0 ? (
          <Rows
            label={m.lms_sync_panel_ignored()}
            rows={ignored}
            answers={answers}
            colors={colors}
            onOpen={open}
          />
        ) : null}
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

function Rows({
  label,
  rows,
  answers,
  colors,
  onOpen,
  note,
}: {
  label: string
  rows: SyncRow[]
  answers: SyncAnswers
  colors: Map<string, string>
  onOpen: (item: SyncItem) => void
  note?: string
}) {
  return (
    <section>
      <h3 className="px-1 pb-1.5 text-xs font-medium text-muted-foreground">{label}</h3>
      <MobileList label={label}>
        {rows.map((row) => (
          <li
            key={row.key}
            className={cn(
              'flex items-center gap-2 pr-3 transition-opacity',
              answers.leaving(row.key) && 'opacity-0',
            )}
          >
            <button
              type="button"
              className="min-w-0 flex-1 py-3 pl-4 text-left"
              onClick={() => onOpen(row.item)}
            >
              <span className="line-clamp-2 font-medium">{row.title}</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: colors.get(row.item.course_id) }}
                />
                <span>{row.item.course}</span>
                <span aria-hidden>·</span>
                <span className="truncate">{row.detail}</span>
              </span>
            </button>
            <div className="flex shrink-0 gap-1.5">
              {row.actions.map((action) => (
                <Button
                  key={action.id}
                  size="sm"
                  variant={VARIANT[action.tone]}
                  disabled={action.disabled}
                  onClick={action.run}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          </li>
        ))}
      </MobileList>
      {note ? <p className="px-1 pt-1.5 text-xs text-muted-foreground">{note}</p> : null}
    </section>
  )
}
