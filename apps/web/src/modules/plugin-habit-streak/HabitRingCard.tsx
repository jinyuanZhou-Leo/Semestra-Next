import { Check } from 'lucide-react'
import { useState } from 'react'
import { CardSkeleton } from '@/app/board/CardSkeleton'
import type { CardProps } from '@/app/extensions'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Toggle } from '@/ui/toggle'
import { Burst } from '../plugin-kit/Burst'
import { colorVar } from '../plugin-kit/colors'
import { Ring } from '../plugin-kit/Ring'
import { HISTORY_WEEKS, columnsRange } from './grid'
import { HabitHistory } from './HabitHistory'
import { HabitIcon } from './icons'
import { useHabitCheckins, useHabitStats } from './queries'
import type { HabitSettings } from './schema'
import { useCheckinFlow } from './useCheckinFlow'

const RING = { s: 'size-20', m: 'size-20', l: 'size-24' } as const

/**
 * Habit (M14 §2): the ring shows the current day's or week's progress and is the one place to
 * check in today; at m and l the card also shows the past weeks, read-only.
 */
export default function HabitRingCard({ instanceId, size, settings }: CardProps<HabitSettings>) {
  const fit = size === 'l' || size === 'xl' ? 'l' : size
  const stats = useHabitStats(instanceId, settings).data
  const range =
    stats && fit !== 's' ? columnsRange(stats.today, stats.week_start, HISTORY_WEEKS) : null
  const checked = new Set(useHabitCheckins(instanceId, range).data?.items ?? [])
  const [burst, setBurst] = useState(false)
  const { press, dialog, pending } = useCheckinFlow(instanceId, settings, {
    toast: true,
    currentStreak: stats?.current_streak,
    onMilestone: () => setBurst(true),
  })

  if (!stats) return <CardSkeleton />

  const color = colorVar(settings.color)
  const name = settings.name || m.habit_default_name()
  const checkedToday = stats.checked_today
  const weekly = stats.goal === 'weekly'
  const streak = weekly
    ? m.habit_streak_weeks({ count: stats.current_streak })
    : m.habit_streak_days({ count: stats.current_streak })
  const detail = weekly
    ? m.habit_week_progress({ done: stats.period_done, target: stats.period_target })
    : m.habit_longest({ count: stats.longest_streak })

  const celebration = burst ? <Burst color={color} onDone={() => setBurst(false)} /> : null

  const ring = (
    <Toggle
      pressed={checkedToday}
      disabled={pending}
      aria-label={`${name}: ${checkedToday ? m.habit_checked_today() : m.habit_check_in()}`}
      onPressedChange={() => press(stats.today, checkedToday)}
      className="h-auto min-w-0 shrink-0 rounded-full bg-transparent p-0 hover:bg-transparent aria-pressed:bg-transparent"
    >
      <Ring ratio={stats.period_done / stats.period_target} color={color} className={RING[fit]}>
        {checkedToday ? (
          <Check aria-hidden className="size-7" style={{ color }} />
        ) : (
          <HabitIcon name={settings.icon} aria-hidden className="size-7 text-muted-foreground" />
        )}
      </Ring>
    </Toggle>
  )

  if (fit === 's') {
    return (
      <div className="relative flex h-full flex-col items-center justify-center gap-1.5 text-center">
        {ring}
        <div className="w-full min-w-0">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{streak}</p>
        </div>
        {celebration}
        {dialog}
      </div>
    )
  }

  const summary = (
    <div className="min-w-0">
      <p className="truncate text-sm font-medium">{name}</p>
      <p className="truncate text-xs text-muted-foreground">{streak}</p>
      <p className="truncate text-xs text-muted-foreground">{detail}</p>
      {fit === 'l' ? (
        <p className="truncate text-xs text-muted-foreground">
          {m.habit_total({ count: stats.total })}
        </p>
      ) : null}
    </div>
  )

  return (
    <div className={cn('relative flex h-full gap-4', fit === 'm' ? 'items-center' : 'flex-col')}>
      <div className={cn('flex items-center gap-4', fit === 'm' ? 'w-56 shrink' : 'flex-1')}>
        {ring}
        {summary}
      </div>
      <HabitHistory
        today={stats.today}
        weekStart={stats.week_start}
        checked={checked}
        color={color}
        size={fit}
        className="min-w-0 flex-1"
      />
      {celebration}
      {dialog}
    </div>
  )
}
