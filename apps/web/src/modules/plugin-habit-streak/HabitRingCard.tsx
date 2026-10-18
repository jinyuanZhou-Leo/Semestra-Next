import { Check } from 'lucide-react'
import type { CardProps } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { cn } from '@/lib/utils'
import { colorVar } from '../plugin-kit/colors'
import { Ring } from '../plugin-kit/Ring'
import { HabitIcon } from './icons'
import { useHabitStats } from './queries'
import type { HabitSettings } from './schema'
import { useCheckinFlow } from './useCheckinFlow'

/** Habit ring (M14 §2): progress of the current day or week; click to check in today. */
export default function HabitRingCard({ instanceId, size, settings }: CardProps<HabitSettings>) {
  const stats = useHabitStats(instanceId, settings).data
  const { press, dialog } = useCheckinFlow(instanceId, settings, { toast: true })
  const color = colorVar(settings.color)
  const name = settings.name || m.habit_default_name()
  const checkedToday = stats?.checked_today ?? false
  const ratio = stats ? stats.period_done / stats.period_target : 0
  const streak = stats
    ? stats.goal === 'weekly'
      ? m.habit_streak_weeks({ count: stats.current_streak })
      : m.habit_streak_days({ count: stats.current_streak })
    : ''

  const ring = (
    <button
      type="button"
      disabled={!stats}
      aria-pressed={checkedToday}
      aria-label={`${name}: ${checkedToday ? m.habit_checked_today() : m.habit_check_in()}`}
      onClick={() => stats && press(stats.today, checkedToday)}
      className="rounded-full focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Ring ratio={ratio} color={color} className={size === 's' ? 'size-20' : 'size-24'}>
        {checkedToday ? (
          <Check aria-hidden className="size-7" style={{ color }} />
        ) : (
          <HabitIcon name={settings.icon} aria-hidden className="size-7 text-muted-foreground" />
        )}
      </Ring>
    </button>
  )

  return (
    <div
      className={cn(
        'flex h-full items-center justify-center gap-4',
        size === 's' && 'flex-col gap-1',
      )}
    >
      {ring}
      <div className={cn('min-w-0', size === 's' && 'text-center')}>
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="text-xs text-muted-foreground">{streak}</p>
        {size !== 's' && stats ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {stats.goal === 'weekly'
              ? m.habit_week_progress({ done: stats.period_done, target: stats.period_target })
              : m.habit_longest({ count: stats.longest_streak })}
          </p>
        ) : null}
      </div>
      {dialog}
    </div>
  )
}
