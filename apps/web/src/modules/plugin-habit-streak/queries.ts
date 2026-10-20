import type { HabitStreakGet } from '@semestra/api-client'
import {
  habitCheckinToggleMutation,
  habitCheckinListOptions,
  habitStreakGetOptions,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toastError } from '@/lib/errors'
import type { HabitSettings } from './schema'

/** Stats follow the goal in the card's settings, which the backend reads: refetch when it changes. */
export function useHabitStats(instanceId: string, settings: HabitSettings) {
  const options = habitStreakGetOptions({ path: { instance_id: instanceId } })
  return useQuery({
    ...options,
    // `tags` is part of the key, so a new goal means a new query.
    queryKey: [{ ...options.queryKey[0], tags: [settings.goal, String(settings.weekly_target)] }],
    staleTime: 30_000,
    // The backend says what "today" is in the Program's zone: ask again now and then, so a card
    // left open overnight does not check in yesterday.
    refetchInterval: 5 * 60_000,
  })
}

export function useHabitCheckins(instanceId: string, range: { from: string; to: string } | null) {
  return useQuery({
    ...habitCheckinListOptions({
      path: { instance_id: instanceId },
      query: { from_date: range?.from ?? '', to_date: range?.to ?? '' },
    }),
    enabled: range !== null,
    staleTime: 30_000,
  })
}

/** Toggles a day; the response carries the new stats, which the card shows after the refetch. */
export function useToggleCheckin(
  instanceId: string,
  onToggled?: (stats: HabitStreakGet, checked: boolean) => void,
) {
  const queryClient = useQueryClient()
  return useMutation({
    ...habitCheckinToggleMutation(),
    onError: toastError,
    onSuccess: (result) => {
      // Query keys are `[{ _id, path, ... }]` and match by subset, so these hit every range/goal.
      for (const id of ['habitStreakGet', 'habitCheckinList']) {
        void queryClient.invalidateQueries({
          queryKey: [{ _id: id, path: { instance_id: instanceId } }],
        })
      }
      onToggled?.(result.stats, result.checked)
    },
  })
}
