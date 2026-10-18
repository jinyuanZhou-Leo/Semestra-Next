import { useCardSettings as useHostCardSettings } from '@/app/board'
import { useCallback } from 'react'
import { type SaveStatus, useOptimisticSettings } from './useOptimisticSettings'

/**
 * A card's settings with instant local updates and delayed saving. `incoming` is the `settings`
 * prop the host gave the card. The host's hook (M10) saves the whole settings object and keeps
 * the board cache in step, so a patch is sent merged into the settings last received.
 */
export function useCardSettings<T extends object>(
  instanceId: string,
  incoming: T,
  delayMs = 300,
): { value: T; update: (patch: Partial<T>) => void; status: SaveStatus } {
  const { save: saveToHost } = useHostCardSettings<T>(instanceId)
  const save = useCallback(
    (patch: Partial<T>) => saveToHost({ ...incoming, ...patch }),
    [saveToHost, incoming],
  )
  const { value, update, status } = useOptimisticSettings(incoming, save, delayMs)
  return { value, update, status }
}
