import type { SyncItem, SyncStatus } from '@semestra/api-client'
import { lmsSyncDismiss, lmsSyncRequest } from '@semestra/api-client'
import { lmsSyncStatusQueryKey } from '@semestra/api-client/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { openStatusPanel } from '@/app/host/StatusBar'
import { useUiPref } from '@/app/ui-pref'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { importAssignments } from '../import/assignments'
import { byCourse, summarizeChanges, summarizeItems } from './labels'
import { takeManualSync } from './manual'
import { SYNC_LINE, useProgramId, useSync } from './status'

/** Ids the reminders have told already, per Program (pending items, applied changes). */
const NONE: string[] = []
const TOLD_MAX = 200

/** Toasts replace each other by id: at most one "to review" and one "updated". */
const REVIEW_TOAST = 'lms.sync.review'
const SYNCED_TOAST = 'lms.sync.synced'
const SYNCED_MS = 8000

/**
 * The sync's reminders (M09 §4.1), rendered once for the signed-in app (`overlays`): toasts, so
 * no page gives up room for them. Opening a Program asks for a sync of its courses not synced in
 * the last half hour. New items and conflicts make one toast that stays until acted on (told
 * again on the next visit if not); what the sync applied makes one that goes after a few
 * seconds; a sync the user asked for that found nothing says the platform is up to date.
 */
export function SyncToasts() {
  const programId = useProgramId()
  return programId ? <Reminders key={programId} programId={programId} /> : null
}

function Reminders({ programId }: { programId: string }) {
  const queryClient = useQueryClient()
  const { status, provider } = useSync(programId)
  // Two prefs, so a click on one toast never writes back a stale copy of the other's list.
  const [toldPending, setToldPending] = useUiPref('lms.sync_told_pending', NONE, {
    scope: programId,
  })
  const [toldChanges, setToldChanges] = useUiPref('lms.sync_told_changes', NONE, {
    scope: programId,
  })
  const shownReview = useRef('')
  const wasSyncing = useRef(false)

  useEffect(() => {
    lmsSyncRequest({ path: { program_id: programId }, body: {} }).catch(() => undefined)
  }, [programId])

  useEffect(() => {
    if (!status || !provider) return
    const update = (next: SyncStatus) =>
      queryClient.setQueryData(lmsSyncStatusQueryKey({ path: { program_id: programId } }), next)
    const pendingIds = status.pending.map((i) => i.id)
    const markTold = () => setToldPending(pendingIds.slice(0, TOLD_MAX))

    // What waits for the user: one toast while any of it is new to them.
    const fresh = status.pending.filter((i) => !toldPending.includes(i.id))
    const signature = pendingIds.join(',')
    if (fresh.length > 0 && shownReview.current !== signature) {
      shownReview.current = signature
      showReview(status.pending, provider, {
        onImport: (items) => {
          markTold()
          void importAll(items, provider)
        },
        onIgnore: (items) => {
          markTold()
          const ids = items.filter((i) => i.kind === 'new').map((i) => i.id)
          if (ids.length === 0) return
          lmsSyncDismiss({
            path: { program_id: programId },
            body: { item_ids: ids },
            throwOnError: true,
          })
            .then(({ data }) => update(data))
            .catch(toastError)
        },
        onView: () => {
          markTold()
          openStatusPanel(SYNC_LINE)
        },
      })
    }

    // What the sync applied, once each.
    const applied = status.recent.filter((c) => !c.reverted && !toldChanges.includes(c.id))
    if (applied.length > 0) {
      toast(m.lms_sync_toast_synced({ provider, count: applied.length }), {
        id: SYNCED_TOAST,
        description: summarizeChanges(applied),
        duration: SYNCED_MS,
        action: { label: m.lms_sync_view(), onClick: () => openStatusPanel(SYNC_LINE) },
      })
      setToldChanges([...applied.map((c) => c.id), ...toldChanges].slice(0, TOLD_MAX))
    }

    // A sync the user asked for that found nothing new.
    if (status.syncing) {
      wasSyncing.current = true
    } else if (wasSyncing.current) {
      wasSyncing.current = false
      if (takeManualSync(programId) && applied.length === 0 && fresh.length === 0) {
        toast.success(m.lms_sync_toast_current({ provider }), {
          id: SYNCED_TOAST,
          description: m.lms_sync_toast_current_detail(),
        })
      }
    }
  }, [
    status,
    provider,
    toldPending,
    toldChanges,
    setToldPending,
    setToldChanges,
    programId,
    queryClient,
  ])

  return null
}

function showReview(
  items: readonly SyncItem[],
  provider: string,
  on: {
    onImport: (items: SyncItem[]) => void
    onIgnore: (items: SyncItem[]) => void
    onView: () => void
  },
) {
  const fresh = items.filter((i) => i.kind === 'new')
  const onlyNew = fresh.length === items.length
  toast(
    onlyNew
      ? m.lms_sync_toast_new({ provider, count: fresh.length })
      : m.lms_sync_toast_review({ provider, count: items.length }),
    {
      id: REVIEW_TOAST,
      description: summarizeItems(onlyNew ? fresh : items),
      // Stays until acted on: it is a decision, not news.
      duration: Number.POSITIVE_INFINITY,
      action: onlyNew
        ? { label: m.lms_sync_import(), onClick: () => on.onImport([...fresh]) }
        : { label: m.lms_sync_view(), onClick: on.onView },
      cancel: { label: m.lms_sync_ignore(), onClick: () => on.onIgnore([...items]) },
    },
  )
}

/** Course by course: one that needs a decision opens its review before the next. */
async function importAll(items: SyncItem[], provider: string) {
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
