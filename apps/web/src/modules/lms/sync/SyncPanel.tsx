import type {
  SyncChange,
  SyncConflict,
  SyncItem,
  SyncMaterialChange,
  SyncStatus,
} from '@semestra/api-client'
import {
  lmsSyncChangeReapply,
  lmsSyncChangeRevert,
  lmsSyncDismiss,
  lmsSyncFieldResolve,
  lmsSyncMaterialRestore,
  lmsSyncMaterialRestoreAll,
  lmsSyncResolve,
} from '@semestra/api-client'
import { lmsSyncRequestMutation, lmsSyncStatusQueryKey } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  ArrowRight,
  CalendarClock,
  CircleAlert,
  ClipboardPlus,
  CloudDownload,
  FileCheck,
  FileMinus,
  FilePen,
  FilePlus,
  Files,
  FileX,
  type LucideIcon,
  MessageSquareText,
  PencilLine,
  Percent,
  Redo2,
  RefreshCw,
  Settings2,
  SquareCheck,
  Trash2,
  Undo2,
} from 'lucide-react'
import { useState } from 'react'
import { useSettingsDialog } from '@/app/settings/use-settings-dialog'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import {
  PanelFold as Fold,
  PanelHeading as SectionTitle,
  PanelMoreList as MoreList,
  PanelRow as Row,
} from '@/components/StatusPanel'
import { IconAction } from '@/components/IconAction'
import { useNow } from '@/hooks/use-now'
import { useDialogTarget } from '@/lib/dialog-target'
import { errorMessage, toastError } from '@/lib/errors'
import { formatDate, formatTimeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { courseColor } from '@/modules/academics/color'
import { useCourses } from '@/modules/academics/queries'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/ui/alert'
import { ItemGroup } from '@/ui/item'
import { Progress } from '@/ui/progress'
import { PopoverDescription, PopoverHeader, PopoverTitle } from '@/ui/popover'
import { Spinner } from '@/ui/spinner'
import { filePath } from '@/modules/files/location'
import { importAssignments } from '../import/assignments'
import { ERROR_LABEL } from '../settings/ConnectionsSection'
import { feedbackPath } from '../feedback'
import { byCourse, fieldLabel, formatValue, pendingCount } from './labels'
import { syncedAgo, useProgramId, useSync } from './status'

/** How long an answered row takes to fold away (M10 §5.6 uses the same). */
const FOLD_MS = 200

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
  const navigate = useNavigate()
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
  const settle = (item: SyncItem, choice: 'keep' | 'delete') =>
    void answer([item.id], () =>
      lmsSyncResolve({ path: { item_id: item.id }, body: { choice }, throwOnError: true }),
    )
  /** Answers about one field: the platform's value, or (asked about only) the user's. */
  const resolveField = (id: string, field: SyncConflict['field'], choice: 'platform' | 'mine') =>
    void answer([`${id}:${field}`], () =>
      lmsSyncFieldResolve({ path: { item_id: id, field }, body: { choice }, throwOnError: true }),
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
  const broken = status.connection_error
    ? errorMessage({ error: { code: status.connection_error } })
    : null
  // Assignment changes and material changes, newest first.
  const recent: Recent[] = [
    ...status.recent.map((change) => ({ ...change, type: 'field' as const })),
    ...status.materials.map((change) => ({ ...change, type: 'material' as const })),
  ].toSorted((a, b) => b.at.localeCompare(a.at))
  const restore = (id: string) =>
    void answer([id], () =>
      lmsSyncMaterialRestore({ path: { material_id: id }, throwOnError: true }),
    )
  /** Every removed material of the Program, also those past the rows listed. */
  const restoreAll = () =>
    void answer(
      status.removed_materials.map((item) => item.id),
      () => lmsSyncMaterialRestoreAll({ path: { program_id: programId }, throwOnError: true }),
    )

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
  const course = (id: string, code: string) => ({ course: code, color: colors.get(id) })

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
          <div className="flex items-center gap-0.5">
            <IconAction
              className="text-muted-foreground"
              label={m.lms_sync_now()}
              disabled={syncing}
              onClick={() =>
                request.mutate({ path: { program_id: programId }, body: { force: true } })
              }
            >
              <RefreshCw aria-hidden className={cn(syncing && 'animate-spin')} />
            </IconAction>
            <IconAction
              className="text-muted-foreground"
              label={m.lms_sync_panel_settings()}
              onClick={() => {
                onClose()
                settings.open({ level: 'account', group: 'lms' })
              }}
            >
              <Settings2 aria-hidden />
            </IconAction>
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
                    (e) => ERROR_LABEL[e.code]?.() ?? errorMessage({ error: { code: e.code } }),
                  ),
                ),
              ].join(' ')}
            </AlertDescription>
          </Alert>
        ) : null}

        {status.pending.length > 0 ? (
          <section className="flex flex-col gap-1">
            <SectionTitle count={pendingCount(status.pending)}>{m.lms_sync_pending()}</SectionTitle>
            <ItemGroup className="gap-0 has-data-[size=xs]:gap-0">
              {status.pending.map((item) =>
                item.kind === 'new' ? (
                  <Fold key={item.id} leaving={leaving.includes(item.id)}>
                    <Row
                      icon={ClipboardPlus}
                      title={item.title}
                      {...course(item.course_id, item.course)}
                      detail={
                        item.due_at
                          ? m.lms_sync_panel_new_due({
                              due: formatDate(item.due_at, { short: true }),
                            })
                          : m.lms_sync_kind_new()
                      }
                    >
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setDismissed([item], true)}
                      >
                        {m.lms_sync_ignore()}
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={Boolean(broken)}
                        onClick={() => void importItems([item])}
                      >
                        {m.lms_sync_import()}
                      </Button>
                    </Row>
                  </Fold>
                ) : item.kind === 'removed' ? (
                  <Fold key={item.id} leaving={leaving.includes(item.id)}>
                    <Row
                      icon={Trash2}
                      title={item.title}
                      {...course(item.course_id, item.course)}
                      detail={m.lms_sync_removed({ provider })}
                    >
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => settle(item, 'keep')}
                      >
                        {m.lms_sync_keep()}
                      </Button>
                      <Button
                        size="xs"
                        variant="destructive"
                        disabled={busy}
                        onClick={() => deleting.show(item)}
                      >
                        {m.lms_sync_delete()}
                      </Button>
                    </Row>
                  </Fold>
                ) : (
                  (item.conflicts ?? []).map((conflict) => (
                    <Fold
                      key={`${item.id}:${conflict.field}`}
                      leaving={leaving.includes(`${item.id}:${conflict.field}`)}
                    >
                      <Row
                        icon={FIELD_ICON[conflict.field] ?? PencilLine}
                        title={m.lms_sync_change({
                          title: item.title,
                          field: fieldLabel(conflict.field),
                        })}
                        {...course(item.course_id, item.course)}
                        detail={
                          <>
                            <Values
                              field={conflict.field}
                              from={conflict.mine}
                              to={conflict.platform}
                            />
                            {conflict.edited ? ` · ${m.lms_sync_yours_changed()}` : null}
                          </>
                        }
                      >
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => resolveField(item.id, conflict.field, 'mine')}
                        >
                          {m.lms_sync_keep()}
                        </Button>
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={busy}
                          onClick={() => resolveField(item.id, conflict.field, 'platform')}
                        >
                          {m.lms_sync_update()}
                        </Button>
                      </Row>
                    </Fold>
                  ))
                ),
              )}
            </ItemGroup>
          </section>
        ) : null}

        <section className="flex flex-col gap-1">
          <SectionTitle>{m.lms_sync_recent()}</SectionTitle>
          {recent.length > 0 ? (
            <ItemGroup className="gap-0 has-data-[size=xs]:gap-0">
              {recent.map((change) =>
                change.type === 'material' ? (
                  <Row
                    key={change.id}
                    icon={MATERIAL_ICON[change.change]}
                    title={change.title}
                    muted={change.change === 'gone'}
                    {...course(change.course_id, change.course)}
                    detail={
                      change.change === 'added' || change.change === 'updated'
                        ? (change.folder ?? MATERIAL_TEXT[change.change](provider))
                        : MATERIAL_TEXT[change.change](provider)
                    }
                    time={formatTimeAgo(change.at, now)}
                    href={
                      change.item_id
                        ? filePath(programId, {
                            id: change.item_id,
                            course_id: change.course_id,
                            folder_id: change.folder_id ?? null,
                          })
                        : undefined
                    }
                    onOpen={onClose}
                  />
                ) : change.kind === 'feedback' ? (
                  <Row
                    key={change.id}
                    icon={MessageSquareText}
                    title={m.lms_sync_change({
                      title: change.title,
                      field: fieldLabel(change.field),
                    })}
                    {...course(change.course_id, change.course)}
                    detail={feedbackDetail(change)}
                    time={formatTimeAgo(change.at, now)}
                    onOpen={() => {
                      onClose()
                      void navigate({
                        href: feedbackPath(programId, change.course_id, change.target_id),
                      })
                    }}
                  />
                ) : (
                  <Row
                    key={change.id}
                    icon={FIELD_ICON[change.field] ?? PencilLine}
                    title={m.lms_sync_change({
                      title: change.title,
                      field: fieldLabel(change.field),
                    })}
                    muted={change.reverted}
                    {...course(change.course_id, change.course)}
                    detail={
                      <Values
                        field={change.field}
                        from={change.old}
                        to={change.new}
                        struck={change.reverted}
                      />
                    }
                    time={change.reverted ? m.lms_sync_undone() : formatTimeAgo(change.at, now)}
                  >
                    {change.toggleable ? (
                      <IconAction
                        label={change.reverted ? m.lms_sync_redo() : m.lms_sync_undo()}
                        disabled={busy}
                        onClick={() => void toggle(change)}
                        className="text-muted-foreground opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100"
                      >
                        {change.reverted ? <Redo2 aria-hidden /> : <Undo2 aria-hidden />}
                      </IconAction>
                    ) : null}
                  </Row>
                ),
              )}
            </ItemGroup>
          ) : (
            <p className="px-2 text-xs text-muted-foreground">{m.lms_sync_recent_empty()}</p>
          )}
        </section>

        {status.different.length > 0 ||
        status.ignored.length > 0 ||
        status.removed_materials.length > 0 ? (
          <section className="flex flex-col gap-0.5 border-t px-2 pt-2">
            {status.different.length > 0 ? (
              <MoreList label={m.lms_sync_different({ provider })} count={status.different.length}>
                {status.different.map((d) => (
                  <Fold key={`${d.id}:${d.field}`} leaving={leaving.includes(`${d.id}:${d.field}`)}>
                    <Row
                      icon={FIELD_ICON[d.field] ?? PencilLine}
                      title={m.lms_sync_change({ title: d.title, field: fieldLabel(d.field) })}
                      {...course(d.course_id, d.course)}
                      detail={m.lms_sync_different_values({
                        mine: formatValue(d.field, d.mine),
                        provider,
                        platform: formatValue(d.field, d.platform),
                      })}
                    >
                      <IconAction
                        className="text-muted-foreground"
                        label={m.lms_sync_follow({ provider })}
                        disabled={busy}
                        onClick={() => resolveField(d.id, d.field, 'platform')}
                      >
                        <CloudDownload aria-hidden />
                      </IconAction>
                    </Row>
                  </Fold>
                ))}
              </MoreList>
            ) : null}
            {status.removed_materials.length > 0 ? (
              <MoreList
                label={m.lms_sync_panel_removed()}
                count={status.removed_count}
                action={
                  status.removed_count > 1 ? (
                    <Button size="xs" variant="ghost" disabled={busy} onClick={restoreAll}>
                      {m.lms_sync_restore_all()}
                    </Button>
                  ) : null
                }
              >
                {status.removed_materials.map((item) => (
                  <Fold key={item.id} leaving={leaving.includes(item.id)}>
                    <Row
                      icon={FileMinus}
                      title={item.title}
                      {...course(item.course_id, item.course)}
                      detail={m.lms_sync_removed_by_you({ ago: formatTimeAgo(item.at, now) })}
                    >
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={busy}
                        onClick={() => restore(item.id)}
                      >
                        {m.lms_sync_restore()}
                      </Button>
                    </Row>
                  </Fold>
                ))}
              </MoreList>
            ) : null}
            {status.ignored.length > 0 ? (
              <MoreList label={m.lms_sync_panel_ignored()} count={status.ignored.length}>
                {status.ignored.map((item) => (
                  <Fold key={item.id} leaving={leaving.includes(item.id)}>
                    <Row
                      icon={ClipboardPlus}
                      title={item.title}
                      {...course(item.course_id, item.course)}
                      detail={m.lms_sync_kind_new()}
                    >
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setDismissed([item], false)}
                      >
                        {m.lms_sync_remind()}
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={Boolean(broken)}
                        onClick={() => void importItems([item])}
                      >
                        {m.lms_sync_import()}
                      </Button>
                    </Row>
                  </Fold>
                ))}
              </MoreList>
            ) : null}
          </section>
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

const FIELD_ICON: Record<string, LucideIcon> = {
  title: PencilLine,
  due_at: CalendarClock,
  weight: Percent,
  score: SquareCheck,
}

const MATERIAL_ICON: Record<SyncMaterialChange['change'], LucideIcon> = {
  added: FilePlus,
  duplicate: Files,
  updated: FilePen,
  gone: FileX,
  handed_over: FileCheck,
}

const MATERIAL_TEXT: Record<SyncMaterialChange['change'], (provider: string) => string> = {
  added: () => m.lms_sync_material_added(),
  duplicate: () => m.lms_sync_material_duplicate(),
  updated: () => m.lms_sync_material_updated(),
  gone: (provider) => m.lms_sync_material_removed({ provider }),
  handed_over: (provider) => m.lms_sync_material_kept({ provider }),
}

/** What new feedback has: comments, a rubric score, or both. */
function feedbackDetail(change: SyncChange): string {
  const news = change.new as { comments?: number; rubric?: boolean } | null
  return [
    news?.comments ? m.lms_sync_feedback_comments() : null,
    news?.rubric ? m.lms_sync_feedback_rubric() : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** A due date without its time when both sides share it ("Nov 25 → Nov 27"). */
function short(field: string, value: unknown, other: unknown): string {
  if (field !== 'due_at' || !value || !other) return formatValue(field, value)
  const a = value as { date: string; time: string | null }
  const b = other as { date: string; time: string | null }
  if (a.time === b.time && a.date !== b.date)
    return formatValue(field, { date: a.date, time: null })
  return formatValue(field, value)
}

type Recent = (SyncChange & { type: 'field' }) | (SyncMaterialChange & { type: 'material' })

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
    <span className="whitespace-nowrap">
      {short(field, from, to)}
      <ArrowRight aria-label="→" className="mx-1 inline size-3 align-[-2px]" />
      <span className={struck ? 'line-through' : 'text-foreground'}>{short(field, to, from)}</span>
    </span>
  )
}
