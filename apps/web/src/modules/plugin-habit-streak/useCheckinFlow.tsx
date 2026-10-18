import type { HabitStats } from '@semestra/api-client'
import { type ReactNode, useCallback, useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { formatDate } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { milestoneAt } from './grid'
import { useToggleCheckin } from './queries'
import type { HabitSettings } from './schema'

/**
 * Check in or out of a day, shared by both habit cards: checking happens at once, removing a
 * check-in asks first (M14 §2). Reaching 7, 30 or 100 in a row calls `onMilestone`.
 */
export function useCheckinFlow(
  instanceId: string,
  settings: HabitSettings,
  options: { toast: boolean; onMilestone?: () => void },
) {
  const [removing, setRemoving] = useState<string | null>(null)
  const { toast: showToast, onMilestone } = options
  const onToggled = useCallback(
    (stats: HabitStats, checked: boolean) => {
      const milestone = checked ? milestoneAt(stats.current_streak) : null
      if (milestone === null) return
      onMilestone?.()
      if (showToast && settings.show_toast) {
        toast.success(
          settings.goal === 'weekly'
            ? m.habit_milestone_weeks({ count: milestone })
            : m.habit_milestone_days({ count: milestone }),
        )
      }
    },
    [onMilestone, showToast, settings.show_toast, settings.goal],
  )
  const toggle = useToggleCheckin(instanceId, onToggled)

  const press = (date: string, checked: boolean) => {
    if (checked) setRemoving(date)
    else toggle.mutate({ path: { instance_id: instanceId }, body: { date } })
  }

  const dialog: ReactNode = (
    <ConfirmDialog
      open={removing !== null}
      onOpenChange={(open) => !open && setRemoving(null)}
      title={m.habit_uncheck_title()}
      description={m.habit_uncheck_description({ date: removing ? formatDate(removing) : '' })}
      confirmLabel={m.habit_uncheck_confirm()}
      pending={toggle.isPending}
      onConfirm={() => {
        if (removing === null) return
        toggle.mutate(
          { path: { instance_id: instanceId }, body: { date: removing } },
          { onSettled: () => setRemoving(null) },
        )
      }}
    />
  )
  return { press, dialog, pending: toggle.isPending }
}
