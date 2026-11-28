import type { SyncStatus } from '@semestra/api-client'
import { lmsSyncStatusOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { formatTimeAgo } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { errorMessage } from '@/lib/errors'
import { useProviderName } from '../providers'
import { staleCourses } from './labels'

/** The id of the sync's status line, for `openStatusPanel`. */
export const SYNC_LINE = 'lms.sync'

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
 * The line under the platform's name in the sync panel and the phone's sheet: the broken
 * connection's error, how far a sync the user asked for is, or when it last synced, "partly" when
 * some course's sync left something not updated (M09 表 5c).
 */
export function syncHeadline(status: SyncStatus, now: number, syncing: boolean): string {
  if (status.connection_error) return errorMessage({ error: { code: status.connection_error } })
  // How far a sync the user asked for is; the background's own shows no count.
  const round = syncing ? (status.round ?? null) : null
  if (round) return m.lms_sync_panel_progress({ done: round.done, total: round.total })
  if (syncing) return m.lms_sync_panel_syncing()
  if (!status.synced_at) return m.lms_sync_meta_waiting()
  const ago = syncedAgo(status.synced_at, now)
  return syncedPartly(status)
    ? m.lms_sync_panel_synced_partly({ ago })
    : m.lms_sync_panel_synced({ ago })
}

/** Whether the last sync left something not updated: a sync error or a part not read. */
export function syncedPartly(status: SyncStatus): boolean {
  return status.problems.length > 0 || staleCourses(status).length > 0
}
