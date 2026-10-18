import { type JsonValue, layoutsCardSettingsUpdate } from '@semestra/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { type SaveStatus, useOptimisticSettings } from './useOptimisticSettings'

/**
 * A card's settings with instant local updates and delayed saving (M10 `layouts.card.settings`).
 * `incoming` is the `settings` prop the host gave the card. The backend replaces the whole
 * settings object, so a patch is sent merged into the settings last received.
 *
 * TODO(M10): use the host's `useCardSettings` from `@/app/board` once it exists, which also
 * writes the saved settings into the board cache.
 */
export function useCardSettings<T extends object>(
  instanceId: string,
  incoming: T,
  delayMs = 300,
): { value: T; update: (patch: Partial<T>) => void; status: SaveStatus } {
  const queryClient = useQueryClient()
  const save = useCallback(
    async (patch: Partial<T>) => {
      await layoutsCardSettingsUpdate({
        path: { instance_id: instanceId },
        body: { settings: { ...incoming, ...patch } as Record<string, JsonValue> },
        throwOnError: true,
      })
      // The host reads the settings from the board; refetch it so `incoming` is the saved copy.
      await queryClient.invalidateQueries({ queryKey: [{ _id: 'layoutsBoardGet' }] })
    },
    [instanceId, incoming, queryClient],
  )
  const { value, update, status } = useOptimisticSettings(incoming, save, delayMs)
  return { value, update, status }
}
