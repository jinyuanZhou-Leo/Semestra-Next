import type { SyncStatus } from '@semestra/api-client'
import { lmsSyncStatusOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { formatTimeAgo } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { useProviderName } from '../providers'

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
