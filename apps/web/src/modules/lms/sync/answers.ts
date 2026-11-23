import type { SyncChange, SyncConflict, SyncItem, SyncStatus } from '@semestra/api-client'
import {
  lmsSyncChangeReapply,
  lmsSyncChangeRevert,
  lmsSyncDismiss,
  lmsSyncFieldResolve,
  lmsSyncMaterialRestore,
  lmsSyncMaterialRestoreAll,
  lmsSyncMaterialRemove,
  lmsSyncMaterialRemoveAll,
  lmsSyncResolve,
} from '@semestra/api-client'
import { lmsSyncStatusQueryKey } from '@semestra/api-client/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toastError } from '@/lib/errors'

/** How long an answered row takes to fold away (M10 §5.6 uses the same). */
const FOLD_MS = 200

/**
 * The answers the sync panel sends (M09 §4.1). Each one returns the new sync status, which
 * replaces the cached one. Rows answered this way leave their list: they fold first (`leaving`),
 * and come back if the answer fails. Nothing else is answered while one is on its way (`busy`).
 */
export function useSyncAnswers(programId: string) {
  const queryClient = useQueryClient()
  const [leaving, setLeaving] = useState<readonly string[]>([])
  const [toggling, setToggling] = useState<string | null>(null)
  const updated = (next: SyncStatus) =>
    queryClient.setQueryData(lmsSyncStatusQueryKey({ path: { program_id: programId } }), next)

  const answer = async (ids: readonly string[], send: () => Promise<{ data: SyncStatus }>) => {
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

  return {
    busy: leaving.length > 0 || toggling !== null,
    leaving: (id: string) => leaving.includes(id),
    /** Keeps or deletes an assignment deleted on the platform. */
    settle: (item: SyncItem, choice: 'keep' | 'delete') =>
      void answer([item.id], () =>
        lmsSyncResolve({ path: { item_id: item.id }, body: { choice }, throwOnError: true }),
      ),
    /** Answers about one field: the platform's value, or (asked about only) the user's. */
    resolveField: (id: string, field: SyncConflict['field'], choice: 'platform' | 'mine') =>
      void answer([`${id}:${field}`], () =>
        lmsSyncFieldResolve({ path: { item_id: id, field }, body: { choice }, throwOnError: true }),
      ),
    /** Ignores new items, or reminds of them again. */
    setDismissed: (items: readonly SyncItem[], dismissed: boolean) => {
      const ids = items.map((i) => i.id)
      void answer(ids, () =>
        lmsSyncDismiss({
          path: { program_id: programId },
          body: { item_ids: ids, dismissed },
          throwOnError: true,
        }),
      )
    },
    restore: (id: string) =>
      void answer([id], () =>
        lmsSyncMaterialRestore({ path: { material_id: id }, throwOnError: true }),
      ),
    /** A material that can't be read for now, read from the platform: removed. */
    removeMaterial: (id: string) =>
      void answer([id], () =>
        lmsSyncMaterialRemove({ path: { material_id: id }, throwOnError: true }),
      ),
    /** Every such material of the Program (`ids`: the rows it removes). */
    removeAllMaterials: (ids: readonly string[]) =>
      void answer(ids, () =>
        lmsSyncMaterialRemoveAll({ path: { program_id: programId }, throwOnError: true }),
      ),
    /** Every removed material of the Program, also those past the rows listed. */
    restoreAll: (ids: readonly string[]) =>
      void answer(ids, () =>
        lmsSyncMaterialRestoreAll({ path: { program_id: programId }, throwOnError: true }),
      ),
    /** Puts a change back, or undoes that; the row stays. */
    toggle: async (change: SyncChange) => {
      setToggling(change.id)
      const call = change.reverted ? lmsSyncChangeReapply : lmsSyncChangeRevert
      try {
        updated((await call({ path: { change_id: change.id }, throwOnError: true })).data)
      } catch (error) {
        toastError(error)
      }
      setToggling(null)
    },
  }
}

export type SyncAnswers = ReturnType<typeof useSyncAnswers>
