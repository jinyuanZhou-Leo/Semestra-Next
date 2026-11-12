import type { SyncChange, SyncItem, SyncStatus } from '@semestra/api-client'
import {
  lmsSyncChangeReapplyMutation,
  lmsSyncChangeRevertMutation,
  lmsSyncDismissMutation,
  lmsSyncRequestMutation,
  lmsSyncResolveMutation,
  lmsSyncStatusQueryKey,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, CircleAlert, RefreshCw } from 'lucide-react'
import { Fragment, type ReactNode, useState } from 'react'
import { useSettingsDialog } from '@/app/settings/use-settings-dialog'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useNow } from '@/hooks/use-now'
import { useDialogTarget } from '@/lib/dialog-target'
import { errorMessage, toastError } from '@/lib/errors'
import { formatTimeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Alert, AlertAction, AlertDescription } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/ui/collapsible'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from '@/ui/item'
import { Spinner } from '@/ui/spinner'
import { importAssignments } from '../import/assignments'
import { ERROR_LABEL } from '../settings/ConnectionsSection'
import { byCourse, fieldLabel, formatValue } from './labels'
import { syncedAgo, useProgramId, useSync } from './status'

const EVERY: Record<SyncStatus['every'], () => string> = {
  '15m': () => m.settings_lms_sync_every_option_15m(),
  '30m': () => m.settings_lms_sync_every_option_30m(),
  '1h': () => m.settings_lms_sync_every_option_1h(),
  '6h': () => m.settings_lms_sync_every_option_6h(),
  '1d': () => m.settings_lms_sync_every_option_1d(),
}

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

/** Rows with a hairline between them, in one group. */
function Rows({ children }: { children: ReactNode[] }) {
  return (
    <ItemGroup className="gap-0">
      {children.map((row, index) => (
        // oxlint-disable-next-line react/no-array-index-key -- rows come keyed by their parent
        <Fragment key={index}>
          {index > 0 ? <ItemSeparator className="my-0" /> : null}
          {row}
        </Fragment>
      ))}
    </ItemGroup>
  )
}

/** One row: its title, up to two lines of detail, and its buttons beside it or (`stacked`,
 * for longer choices) under it. */
function Row({
  title,
  description,
  actions,
  stacked = false,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  stacked?: boolean
  className?: string
}) {
  return (
    <Item size="xs" className={cn('group/sync-row gap-2 px-0', className)}>
      <ItemContent className="min-w-0">
        <ItemTitle className="w-full">
          <span className="truncate">{title}</span>
        </ItemTitle>
        {description ? <ItemDescription className="text-xs">{description}</ItemDescription> : null}
      </ItemContent>
      {actions && stacked ? (
        <ItemFooter className="justify-end gap-1">{actions}</ItemFooter>
      ) : actions ? (
        <ItemActions className="shrink-0 gap-1">{actions}</ItemActions>
      ) : null}
    </Item>
  )
}

/**
 * The panel of the LMS status line (M09 §4.1): when the courses last synced, "Sync now", what
 * waits for the user (new assignments, values both sides changed, items deleted on the
 * platform), what the sync changed lately (the latest change of a value the user has not changed since can be undone) and the ignored new items.
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
  const [busy, setBusy] = useState<string | null>(null)
  const key = lmsSyncStatusQueryKey({ path: { program_id: programId } })
  const updated = (next: SyncStatus) => queryClient.setQueryData(key, next)
  const settled = () => setBusy(null)

  const request = useMutation({
    ...lmsSyncRequestMutation(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    onError: toastError,
  })
  const resolve = useMutation({
    ...lmsSyncResolveMutation(),
    onSuccess: updated,
    onError: toastError,
    onSettled: settled,
  })
  const dismiss = useMutation({
    ...lmsSyncDismissMutation(),
    onSuccess: updated,
    onError: toastError,
    onSettled: settled,
  })
  const revert = useMutation({
    ...lmsSyncChangeRevertMutation(),
    onSuccess: updated,
    onError: toastError,
    onSettled: settled,
  })
  const reapply = useMutation({
    ...lmsSyncChangeReapplyMutation(),
    onSuccess: updated,
    onError: toastError,
    onSettled: settled,
  })

  const settle = (item: SyncItem, choice: 'platform' | 'mine' | 'keep' | 'delete') => {
    setBusy(item.id)
    resolve.mutate({ path: { item_id: item.id }, body: { choice } })
  }
  const setDismissed = (items: SyncItem[], dismissed: boolean) => {
    setBusy(items[0]?.id ?? null)
    dismiss.mutate({
      path: { program_id: programId },
      body: { item_ids: items.map((i) => i.id), dismissed },
    })
  }
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

  const fresh = status.pending.filter((i) => i.kind === 'new')
  const asked = status.pending.filter((i) => i.kind !== 'new')
  const syncing = status.syncing || request.isPending
  const every = EVERY[status.every]()
  const subtitle = status.synced_at
    ? m.lms_sync_subtitle({ ago: syncedAgo(status.synced_at, now), every })
    : m.lms_sync_subtitle_never({ every })

  return (
    <div className="flex max-h-[min(32rem,70vh)] flex-col gap-3 overflow-y-auto">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{provider}</p>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={syncing || Boolean(status.connection_error)}
          onClick={() => request.mutate({ path: { program_id: programId }, body: { force: true } })}
        >
          {syncing ? <Spinner aria-hidden /> : <RefreshCw aria-hidden />}
          {m.lms_sync_now()}
        </Button>
      </div>

      {status.connection_error ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>
            {errorMessage({ error: { code: status.connection_error } })}
          </AlertDescription>
          <AlertAction>
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                onClose()
                settings.open({ level: 'account', group: 'lms' })
              }}
            >
              {m.lms_sync_open_settings()}
            </Button>
          </AlertAction>
        </Alert>
      ) : null}

      {status.errors.length > 0 && !status.connection_error ? (
        <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
          {status.errors.map((e) => (
            <li key={`${e.course_id}:${e.stage}`} className="flex items-center gap-1.5">
              <CircleAlert aria-hidden className="size-3.5 shrink-0 text-destructive" />
              <span className="truncate">
                {m.lms_sync_course_failed({
                  course: e.course,
                  reason: ERROR_LABEL[e.code]?.() ?? errorMessage({ error: { code: e.code } }),
                })}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {status.pending.length > 0 ? (
        <Section title={m.lms_sync_pending()}>
          <Rows>
            {[
              ...byCourse(fresh).map((group) => (
                <Row
                  key={`new:${group.courseId}`}
                  title={`${group.items[0]?.course ?? ''} · ${m.lms_sync_new_assignments({ count: group.items.length })}`}
                  description={group.items.map((i) => i.title).join(m.common_list_separator())}
                  actions={
                    <>
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={busy !== null}
                        onClick={() => setDismissed(group.items, true)}
                      >
                        {m.lms_sync_ignore()}
                      </Button>
                      <Button size="xs" onClick={() => void importItems(group.items)}>
                        {m.lms_sync_import()}
                      </Button>
                    </>
                  }
                />
              )),
              ...asked.map((item) => (
                <AskedRow
                  key={item.id}
                  item={item}
                  provider={provider}
                  busy={busy !== null}
                  onSettle={(choice) =>
                    choice === 'delete' ? deleting.show(item) : settle(item, choice)
                  }
                />
              )),
            ]}
          </Rows>
        </Section>
      ) : null}

      <Section title={m.lms_sync_recent()}>
        {status.recent.length > 0 ? (
          <Rows>
            {status.recent.map((change) => (
              <ChangeRow
                key={change.id}
                change={change}
                now={now}
                busy={busy !== null}
                onToggle={() => {
                  setBusy(change.id)
                  const action = change.reverted ? reapply : revert
                  action.mutate({ path: { change_id: change.id } })
                }}
              />
            ))}
          </Rows>
        ) : (
          <p className="py-1 text-xs text-muted-foreground">{m.lms_sync_recent_empty()}</p>
        )}
      </Section>

      {status.ignored.length > 0 ? (
        <Collapsible>
          <CollapsibleTrigger
            render={
              <Button
                size="xs"
                variant="ghost"
                className="-ml-2 text-muted-foreground [&[data-panel-open]>svg]:rotate-90"
              />
            }
          >
            <ChevronRight aria-hidden className="transition-transform" />
            {m.lms_sync_ignored({ count: status.ignored.length })}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Rows>
              {status.ignored.map((item) => (
                <Row
                  key={item.id}
                  title={`${item.course} ${item.title}`}
                  actions={
                    <>
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={busy !== null}
                        onClick={() => setDismissed([item], false)}
                      >
                        {m.lms_sync_remind()}
                      </Button>
                      <Button size="xs" variant="outline" onClick={() => void importItems([item])}>
                        {m.lms_sync_import()}
                      </Button>
                    </>
                  }
                />
              ))}
            </Rows>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      <ConfirmDialog
        {...deleting.props}
        title={m.lms_sync_delete_title({ title: deleting.target?.title ?? '' })}
        description={m.lms_sync_delete_description({ provider })}
        confirmLabel={m.lms_sync_delete()}
        pending={resolve.isPending}
        onConfirm={() => {
          if (deleting.target) settle(deleting.target, 'delete')
          deleting.close()
        }}
      />
    </div>
  )
}

function AskedRow({
  item,
  provider,
  busy,
  onSettle,
}: {
  item: SyncItem
  provider: string
  busy: boolean
  onSettle: (choice: 'platform' | 'mine' | 'keep' | 'delete') => void
}) {
  if (item.kind === 'removed') {
    return (
      <Row
        title={`${item.course} ${item.title}`}
        description={m.lms_sync_removed({ provider })}
        actions={
          <>
            <Button size="xs" variant="ghost" disabled={busy} onClick={() => onSettle('keep')}>
              {m.lms_sync_keep()}
            </Button>
            <Button
              size="xs"
              variant="destructive"
              disabled={busy}
              onClick={() => onSettle('delete')}
            >
              {m.lms_sync_delete()}
            </Button>
          </>
        }
      />
    )
  }
  const fields = item.conflicts ?? []
  return (
    <Row
      title={`${item.course} ${item.title} ${fields.map((c) => fieldLabel(c.field)).join(m.common_list_separator())}`}
      description={fields
        .map((c) =>
          m.lms_sync_conflict({
            mine: formatValue(c.field, c.mine),
            provider,
            platform: formatValue(c.field, c.platform),
          }),
        )
        .join(' · ')}
      stacked
      actions={
        <>
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => onSettle('mine')}>
            {m.lms_sync_keep()}
          </Button>
          <Button size="xs" disabled={busy} onClick={() => onSettle('platform')}>
            {m.lms_sync_update()}
          </Button>
        </>
      }
    />
  )
}

function ChangeRow({
  change,
  now,
  busy,
  onToggle,
}: {
  change: SyncChange
  now: number
  busy: boolean
  /** Puts the change back, or applies it again once put back. */
  onToggle: () => void
}) {
  const toggle = change.toggleable ? (
    <Button
      size="xs"
      variant="ghost"
      disabled={busy}
      className="opacity-0 group-hover/sync-row:opacity-100 focus-visible:opacity-100"
      onClick={onToggle}
    >
      {change.reverted ? m.lms_sync_redo() : m.lms_sync_undo()}
    </Button>
  ) : null
  return (
    <Row
      title={`${change.course} ${m.lms_sync_change({ title: change.title, field: fieldLabel(change.field) })}`}
      description={`${formatValue(change.field, change.old)} → ${formatValue(change.field, change.new)} · ${formatTimeAgo(change.at, now)}`}
      className={cn(change.reverted && 'text-muted-foreground')}
      actions={
        change.reverted ? (
          <>
            {toggle}
            <span className="text-xs text-muted-foreground">{m.lms_sync_undone()}</span>
          </>
        ) : (
          toggle
        )
      }
    />
  )
}
