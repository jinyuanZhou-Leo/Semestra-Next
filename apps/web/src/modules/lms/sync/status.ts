import type { SyncStatus } from '@semestra/api-client'
import { lmsSyncStatusOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { BellDot, CircleAlert, School } from 'lucide-react'
import { type StatusItem, preloadable } from '@/app/extensions'
import { useNow } from '@/hooks/use-now'
import { formatTimeAgo } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { useProviderName } from '../providers'
import { pendingCount } from './labels'

/** The id of the sync's status line, for `openStatusPanel`. */
export const SYNC_LINE = 'lms.sync'

const SyncPanel = preloadable<{ onClose: () => void }>(() => import('./SyncPanel'))

export function syncStatusOptions(programId: string | undefined) {
  return {
    ...lmsSyncStatusOptions({ path: { program_id: programId ?? '' } }),
    enabled: Boolean(programId),
  }
}

/** The Program being viewed, from the route; none outside a Program. */
export function useProgramId(): string | undefined {
  return (useParams({ strict: false }) as { programId?: string }).programId
}

/** The Program's sync and the name of its platform; null while unbound or loading. */
export function useSync(programId: string | undefined): {
  status: SyncStatus | undefined
  provider: string | null
} {
  const status = useQuery(syncStatusOptions(programId)).data
  const provider = useProviderName(status?.provider)
  return { status, provider }
}

/** Whether the Program's sync has a status line (and so a panel): bound, with something to sync. */
export function hasSyncLine(status: SyncStatus | undefined): status is SyncStatus {
  return (
    status !== undefined &&
    Boolean(status.provider) &&
    (status.courses > 0 || status.pending.length > 0)
  )
}

const JUST_NOW_MS = 60_000

/** "12 minutes ago", or "just now" in the first minute (not "now", which reads as a promise). */
export function syncedAgo(at: string, now: number): string {
  return now - new Date(at).getTime() < JUST_NOW_MS ? m.lms_sync_just_now() : formatTimeAgo(at, now)
}

/**
 * The status line of the Program's LMS sync (M09 §4.1): there whenever the Program is bound,
 * so starting or ending a job only grows the bar from one line to two. What waits for the user
 * ranks above running jobs; a broken connection above everything.
 */
export function useSyncLine(): StatusItem | null {
  const programId = useProgramId()
  const { status, provider } = useSync(programId)
  const now = useNow()
  if (!hasSyncLine(status) || !provider) return null
  const line = { rank: 'idle', icon: School, Panel: SyncPanel } as const
  if (status.connection_error) {
    return {
      ...line,
      rank: 'error',
      icon: CircleAlert,
      tone: 'error',
      label: m.lms_sync_line_reconnect({ provider }),
    }
  }
  if (status.pending.length > 0) {
    return {
      ...line,
      rank: 'attention',
      icon: BellDot,
      tone: 'accent',
      label: m.lms_sync_line_pending({ provider, count: pendingCount(status.pending) }),
    }
  }
  if (status.syncing) return { ...line, spin: true, label: m.lms_sync_line_syncing({ provider }) }
  if (status.errors.length > 0) {
    return { ...line, icon: CircleAlert, label: m.lms_sync_line_failed({ provider }) }
  }
  if (!status.synced_at) return { ...line, label: m.lms_sync_line_waiting({ provider }) }
  return {
    ...line,
    label: m.lms_sync_line_synced({ provider, ago: syncedAgo(status.synced_at, now) }),
  }
}
