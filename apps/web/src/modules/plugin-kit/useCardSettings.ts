import { useCallback } from 'react'
import { type SaveStatus, useOptimisticSettings } from './useOptimisticSettings'

/**
 * A card's settings with instant local updates and delayed saving (M10 `layouts.card.settings`).
 * `incoming` is the `settings` prop the host gave the card.
 *
 * TODO(M10): save through `layoutsCardSettingsUpdate` and write the result into the query cache.
 */
export function useCardSettings<T extends object>(
  instanceId: string,
  incoming: T,
  delayMs = 300,
): { value: T; update: (patch: Partial<T>) => void; status: SaveStatus } {
  const save = useCallback(
    async (patch: Partial<T>) => {
      void instanceId
      void patch
    },
    [instanceId],
  )
  const { value, update, status } = useOptimisticSettings(incoming, save, delayMs)
  return { value, update, status }
}
