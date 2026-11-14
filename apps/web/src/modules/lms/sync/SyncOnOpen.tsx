import { lmsSyncRequest } from '@semestra/api-client'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { syncStatusOptions, useProgramId } from './status'

/**
 * Opening a Program asks for a sync of its courses not synced in the last half hour (M09 §4.1),
 * rendered once for the signed-in app (`overlays`). What the sync finds shows on its status line,
 * not in a toast.
 */
export function SyncOnOpen() {
  const programId = useProgramId()
  // A Program without a platform has nothing to sync: no request for it.
  const bound = Boolean(useQuery(syncStatusOptions(programId)).data?.provider)
  useEffect(() => {
    if (!programId || !bound) return
    lmsSyncRequest({ path: { program_id: programId }, body: {} }).catch(() => undefined)
  }, [programId, bound])
  return null
}
