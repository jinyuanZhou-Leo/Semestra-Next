import { CircleAlert, School } from 'lucide-react'
import { type StatusItem, preloadable } from '@/app/extensions'
import { useNow } from '@/hooks/use-now'
import { m } from '@/paraglide/messages'
import { pendingCount } from './labels'
import { hasSyncLine, syncedAgo, useProgramId, useSync } from './status'

const SyncPanel = preloadable<{ onClose: () => void }>(() => import('./SyncPanel'))

/**
 * The status line of the Program's LMS sync (M09 §4.1): there whenever the Program is bound,
 * so starting or ending a job only grows the bar from one line to two. It always reads as the
 * platform's name; the state is in the icon and at the line's end (when it last synced, how far
 * a "Sync now" is, how many items wait), and a reason in the tooltip. What waits for the user
 * ranks above running jobs; a broken connection above everything.
 */
export function useSyncLine(): StatusItem | null {
  const programId = useProgramId()
  const { status, provider } = useSync(programId)
  const now = useNow()
  if (!hasSyncLine(status) || !provider) return null
  // Each state names its rank, so a red line never ranks as a resting one.
  const line = { icon: School, Panel: SyncPanel, label: provider } as const
  if (status.connection_error) {
    return {
      ...line,
      rank: 'error',
      icon: CircleAlert,
      tone: 'error',
      meta: m.lms_sync_meta_reconnect(),
      hint: m.lms_sync_hint_reconnect({ provider }),
    }
  }
  const pending = status.pending.length > 0 ? pendingCount(status.pending) : 0
  const waiting =
    pending > 0 ? { rank: 'attention' as const, badge: pending } : { rank: 'idle' as const }
  if (status.syncing) {
    const round = status.round
    return {
      ...line,
      ...waiting,
      spin: true,
      meta: round ? `${round.done}/${round.total}` : undefined,
      progress: round ? (round.done / round.total) * 100 : undefined,
    }
  }
  if (pending > 0) {
    return { ...line, ...waiting, hint: m.lms_sync_line_pending({ provider, count: pending }) }
  }
  if (status.errors.length > 0) {
    const courses = [...new Set(status.errors.map((e) => e.course))].join(
      m.lms_sync_list_separator(),
    )
    return {
      ...line,
      rank: 'error',
      icon: CircleAlert,
      tone: 'error',
      hint: m.lms_sync_hint_failed({ courses }),
    }
  }
  if (!status.synced_at) return { ...line, rank: 'idle', meta: m.lms_sync_meta_waiting() }
  return { ...line, rank: 'idle', meta: syncedAgo(status.synced_at, now) }
}
