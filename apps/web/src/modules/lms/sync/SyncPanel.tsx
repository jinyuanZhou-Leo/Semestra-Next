import type { SyncChange, SyncItem, SyncStatus } from '@semestra/api-client'
import {
  lmsSyncChangeReapply,
  lmsSyncChangeRevert,
  lmsSyncDismiss,
  lmsSyncResolve,
} from '@semestra/api-client'
import { lmsSyncRequestMutation, lmsSyncStatusQueryKey } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, ChevronRight, CircleAlert, Redo2, RefreshCw, Undo2 } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useSettingsDialog } from '@/app/settings/use-settings-dialog'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useNow } from '@/hooks/use-now'
import { useDialogTarget } from '@/lib/dialog-target'
import { errorMessage, toastError } from '@/lib/errors'
import { formatTimeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { courseColor } from '@/modules/academics/color'
import { useCourses } from '@/modules/academics/queries'
import { m } from '@/paraglide/messages'
import { Alert, AlertAction, AlertDescription } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/ui/collapsible'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/ui/item'
import { PopoverDescription, PopoverHeader, PopoverTitle } from '@/ui/popover'
import { Spinner } from '@/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
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

/** How long an answered row takes to fold away (M10 §5.6 uses the same). */
const FOLD_MS = 200

type Choice = 'platform' | 'mine' | 'keep' | 'delete'

/**
 * The panel of the LMS status line (M09 §4.1). The header (platform, last sync, "Sync now")
 * stays put while the rest scrolls: what waits for the user (new assignments, values both sides
 * changed, items deleted on the platform), what the sync changed lately (each can be put back,
 * and that undone) and the ignored new items, every list grouped by course.
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
  // Rows being answered: they fold away while the answer is sent.
  const [leaving, setLeaving] = useState<readonly string[]>([])
  const [toggling, setToggling] = useState<string | null>(null)
  const colors = new Map(
    (useCourses(programId).data?.items ?? []).map((course) => [course.id, courseColor(course)]),
  )
  const key = lmsSyncStatusQueryKey({ path: { program_id: programId } })
  const updated = (next: SyncStatus) => queryClient.setQueryData(key, next)

  const request = useMutation({
    ...lmsSyncRequestMutation(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    onError: toastError,
  })

  /** Answers rows that then leave the list: they fold first, and come back if it fails. */
  const answer = async (ids: string[], send: () => Promise<{ data: SyncStatus }>) => {
    setLeaving((current) => [...current, ...ids])
    const folded = new Promise((done) => setTimeout(done, FOLD_MS))
    let next: SyncStatus | null = null
    try {
      next = (await send()).data
    } catch (error) {
      toastError(error)
    }
    await folded
    if (next) updated(next)
    setLeaving((current) => current.filter((id) => !ids.includes(id)))
  }
  const settle = (item: SyncItem, choice: Choice) =>
    void answer([item.id], () =>
      lmsSyncResolve({ path: { item_id: item.id }, body: { choice }, throwOnError: true }),
    )
  const setDismissed = (items: SyncItem[], dismissed: boolean) => {
    const ids = items.map((i) => i.id)
    void answer(ids, () =>
      lmsSyncDismiss({
        path: { program_id: programId },
        body: { item_ids: ids, dismissed },
        throwOnError: true,
      }),
    )
  }
  const toggle = async (change: SyncChange) => {
    setToggling(change.id)
    const call = change.reverted ? lmsSyncChangeReapply : lmsSyncChangeRevert
    try {
      updated((await call({ path: { change_id: change.id }, throwOnError: true })).data)
    } catch (error) {
      toastError(error)
    }
    setToggling(null)
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

  const busy = leaving.length > 0 || toggling !== null
  const syncing = status.syncing || request.isPending
  const every = EVERY[status.every]()
  const subtitle = syncing
    ? m.lms_sync_subtitle_syncing({ count: status.courses })
    : status.synced_at
      ? m.lms_sync_subtitle({ ago: syncedAgo(status.synced_at, now), every })
      : m.lms_sync_subtitle_never({ every })
  const groupProps = (courseId: string) => ({ color: colors.get(courseId) })

  return (
    <div className="-m-4 flex max-h-[min(36rem,75vh)] flex-col">
      <div className="flex items-start gap-3 border-b p-4 pb-3">
        <PopoverHeader className="min-w-0 flex-1 gap-0.5">
          <PopoverTitle className="truncate text-sm">{provider}</PopoverTitle>
          <PopoverDescription className="text-xs">{subtitle}</PopoverDescription>
        </PopoverHeader>
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

      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4 pt-3">
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
          <section className="flex flex-col gap-2">
            <h3 className="text-xs text-muted-foreground">
              {m.lms_sync_pending()}{' '}
              <span className="text-muted-foreground/70 tabular-nums">{status.pending.length}</span>
            </h3>
            {byCourse(status.pending).map((group) => {
              const fresh = group.items.filter((i) => i.kind === 'new')
              const asked = group.items.filter((i) => i.kind !== 'new')
              return (
                <CourseGroup
                  key={group.courseId}
                  course={group.course}
                  {...groupProps(group.courseId)}
                >
                  {fresh.length > 0 ? (
                    <Fold leaving={fresh.every((i) => leaving.includes(i.id))}>
                      <Item size="xs" className="px-0 py-1.5">
                        <ItemContent className="min-w-0">
                          <ItemTitle className="w-full">
                            <span className="truncate">
                              {fresh.map((i) => i.title).join(m.common_list_separator())}
                            </span>
                          </ItemTitle>
                          <ItemDescription className="text-xs">
                            {m.lms_sync_kind_new()}
                          </ItemDescription>
                        </ItemContent>
                        <ItemActions className="gap-1.5">
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={busy}
                            onClick={() => setDismissed(fresh, true)}
                          >
                            {m.lms_sync_ignore()}
                          </Button>
                          <Button size="xs" onClick={() => void importItems(fresh)}>
                            {m.lms_sync_import()}
                          </Button>
                        </ItemActions>
                      </Item>
                    </Fold>
                  ) : null}
                  {asked.map((item) => (
                    <Fold key={item.id} leaving={leaving.includes(item.id)}>
                      <AskedRow
                        item={item}
                        provider={provider}
                        busy={busy}
                        onSettle={(choice) =>
                          choice === 'delete' ? deleting.show(item) : settle(item, choice)
                        }
                      />
                    </Fold>
                  ))}
                </CourseGroup>
              )
            })}
          </section>
        ) : null}

        <section className="flex flex-col gap-2">
          <h3 className="text-xs text-muted-foreground">{m.lms_sync_recent()}</h3>
          {status.recent.length > 0 ? (
            byCourse(status.recent).map((group) => (
              <CourseGroup
                key={group.courseId}
                course={group.course}
                {...groupProps(group.courseId)}
              >
                {group.items.map((change) => (
                  <ChangeRow
                    key={change.id}
                    change={change}
                    now={now}
                    busy={busy}
                    onToggle={() => void toggle(change)}
                  />
                ))}
              </CourseGroup>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">{m.lms_sync_recent_empty()}</p>
          )}
        </section>

        {status.ignored.length > 0 ? (
          <Collapsible className="flex flex-col gap-2">
            <CollapsibleTrigger
              render={
                <Button
                  size="xs"
                  variant="ghost"
                  className="-ml-2 self-start text-muted-foreground [&[data-panel-open]>svg]:rotate-90"
                />
              }
            >
              <ChevronRight aria-hidden className="transition-transform" />
              {m.lms_sync_ignored({ count: status.ignored.length })}
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-2">
              {byCourse(status.ignored).map((group) => (
                <CourseGroup
                  key={group.courseId}
                  course={group.course}
                  {...groupProps(group.courseId)}
                >
                  {group.items.map((item) => (
                    <Fold key={item.id} leaving={leaving.includes(item.id)}>
                      <Item size="xs" className="px-0 py-1.5">
                        <ItemContent className="min-w-0">
                          <ItemTitle className="w-full">
                            <span className="truncate">{item.title}</span>
                          </ItemTitle>
                          <ItemDescription className="text-xs">
                            {m.lms_sync_kind_new()}
                          </ItemDescription>
                        </ItemContent>
                        <ItemActions className="gap-1.5">
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={busy}
                            onClick={() => setDismissed([item], false)}
                          >
                            {m.lms_sync_remind()}
                          </Button>
                          <Button size="xs" onClick={() => void importItems([item])}>
                            {m.lms_sync_import()}
                          </Button>
                        </ItemActions>
                      </Item>
                    </Fold>
                  ))}
                </CourseGroup>
              ))}
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </div>

      <ConfirmDialog
        {...deleting.props}
        title={m.lms_sync_delete_title({ title: deleting.target?.title ?? '' })}
        description={m.lms_sync_delete_description({ provider })}
        confirmLabel={m.lms_sync_delete()}
        onConfirm={() => {
          if (deleting.target) settle(deleting.target, 'delete')
          deleting.close()
        }}
      />
    </div>
  )
}

/** A course's rows under its color dot and code. */
function CourseGroup({
  course,
  color,
  children,
}: {
  course: string
  color: string | undefined
  children: ReactNode
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full bg-muted-foreground"
          style={color ? { backgroundColor: color } : undefined}
        />
        <span className="truncate">{course}</span>
      </div>
      <ItemGroup aria-label={course} className="gap-0 pl-4 has-data-[size=xs]:gap-0">
        {children}
      </ItemGroup>
    </div>
  )
}

/** A row that folds away (200 ms, in height) once answered. */
function Fold({ leaving, children }: { leaving: boolean; children: ReactNode }) {
  return (
    <div
      inert={leaving}
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none',
        leaving ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100',
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}

/** "20% → 25%", the arrow an icon; the new value in the body color (struck when put back). */
function Values({
  field,
  from,
  to,
  struck = false,
}: {
  field: string
  from: unknown
  to: unknown
  struck?: boolean
}) {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1">
      <span className="whitespace-nowrap">{formatValue(field, from)}</span>
      <ArrowRight aria-label="→" className="size-3 shrink-0" />
      <span className={cn('whitespace-nowrap', struck ? 'line-through' : 'text-foreground')}>
        {formatValue(field, to)}
      </span>
    </span>
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
  onSettle: (choice: Choice) => void
}) {
  const removed = item.kind === 'removed'
  const fields = item.conflicts ?? []
  return (
    <Item size="xs" className="px-0 py-1.5">
      <ItemContent className="min-w-0">
        <ItemTitle className="w-full">
          <span className="truncate">
            {removed
              ? item.title
              : m.lms_sync_change({
                  title: item.title,
                  field: fields.map((c) => fieldLabel(c.field)).join(m.common_list_separator()),
                })}
          </span>
        </ItemTitle>
        <ItemDescription className="flex flex-wrap items-center gap-x-1 text-xs">
          {removed ? (
            m.lms_sync_removed({ provider })
          ) : (
            <>
              {fields.map((c, index) => (
                <span key={c.field} className="inline-flex items-center gap-1">
                  {index > 0 ? <span aria-hidden>·</span> : null}
                  <Values field={c.field} from={c.mine} to={c.platform} />
                </span>
              ))}
              {fields.some((c) => c.edited) ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{m.lms_sync_yours_changed()}</span>
                </>
              ) : null}
            </>
          )}
        </ItemDescription>
      </ItemContent>
      <ItemActions className="gap-1.5">
        <Button
          size="xs"
          variant="outline"
          disabled={busy}
          onClick={() => onSettle(removed ? 'keep' : 'mine')}
        >
          {m.lms_sync_keep()}
        </Button>
        {removed ? (
          <Button
            size="xs"
            variant="destructive"
            disabled={busy}
            onClick={() => onSettle('delete')}
          >
            {m.lms_sync_delete()}
          </Button>
        ) : (
          <Button size="xs" disabled={busy} onClick={() => onSettle('platform')}>
            {m.lms_sync_update()}
          </Button>
        )}
      </ItemActions>
    </Item>
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
  const label = change.reverted ? m.lms_sync_redo() : m.lms_sync_undo()
  const Icon = change.reverted ? Redo2 : Undo2
  return (
    <Item size="xs" className={cn('px-0 py-1.5', change.reverted && 'text-muted-foreground')}>
      <ItemContent className="min-w-0">
        <ItemTitle className="w-full">
          <span className="truncate">
            {m.lms_sync_change({ title: change.title, field: fieldLabel(change.field) })}
          </span>
        </ItemTitle>
        <ItemDescription className="flex flex-wrap items-center gap-x-1 text-xs">
          {change.reverted ? (
            <>
              <span>{m.lms_sync_undone()}</span>
              <span aria-hidden>·</span>
            </>
          ) : null}
          <Values field={change.field} from={change.old} to={change.new} struck={change.reverted} />
          {change.reverted ? null : (
            <>
              <span aria-hidden>·</span>
              <span>{formatTimeAgo(change.at, now)}</span>
            </>
          )}
        </ItemDescription>
      </ItemContent>
      {change.toggleable ? (
        <ItemActions>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="outline"
                  aria-label={label}
                  disabled={busy}
                  onClick={onToggle}
                />
              }
            >
              <Icon aria-hidden />
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        </ItemActions>
      ) : null}
    </Item>
  )
}
