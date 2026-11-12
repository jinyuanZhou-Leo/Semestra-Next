import { lmsSyncRequest } from '@semestra/api-client'
import { useEffect } from 'react'
import { useProgramId } from './status'

/**
 * Opening a Program asks for a sync of its courses not synced in the last half hour (M09 §4.1),
 * rendered once for the signed-in app (`overlays`). What the sync finds shows on its status line,
 * not in a toast.
 */
export function SyncOnOpen() {
  const programId = useProgramId()
  useEffect(() => {
    if (!programId) return
    lmsSyncRequest({ path: { program_id: programId }, body: {} }).catch(() => undefined)
  }, [programId])
  return null
}
