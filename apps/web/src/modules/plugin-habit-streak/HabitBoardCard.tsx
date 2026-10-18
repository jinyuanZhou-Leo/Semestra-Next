import { useState } from 'react'
import type { CardProps } from '@/app/extensions'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Burst } from '../plugin-kit/Burst'
import { colorVar } from '../plugin-kit/colors'
import { BOARD_WEEKS, addDays, columnsRange, weekColumns } from './grid'
import { HabitIcon } from './icons'
import { useHabitCheckins, useHabitStats } from './queries'
import type { HabitSettings } from './schema'
import { useCheckinFlow } from './useCheckinFlow'

const CELL = { m: 'size-3.5', l: 'size-5', xl: 'size-5' } as const

/** Habit calendar (M14 §2): the last 5/10/20 weeks as a grid of days; click a day to check it. */
export default function HabitBoardCard({ instanceId, size, settings }: CardProps<HabitSettings>) {
  const weeks = BOARD_WEEKS[size === 'm' || size === 'l' ? size : 'xl']
  const stats = useHabitStats(instanceId, settings).data
  const range = stats ? columnsRange(stats.today, stats.week_start, weeks) : null
  const checked = new Set(useHabitCheckins(instanceId, range).data?.items ?? [])
  const [burst, setBurst] = useState(false)
  const { press, dialog } = useCheckinFlow(instanceId, settings, {
    toast: false,
    onMilestone: () => setBurst(true),
  })

  const color = colorVar(settings.color)
  const earliest = stats ? addDays(stats.today, -7) : ''
  const streak =
    stats &&
    (stats.goal === 'weekly'
      ? m.habit_streak_weeks({ count: stats.current_streak })
      : m.habit_streak_days({ count: stats.current_streak }))

  return (
    <div className="relative flex h-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <HabitIcon
            name={settings.icon}
            aria-hidden
            className="size-4 shrink-0"
            style={{ color }}
          />
          <span className="truncate">{settings.name || m.habit_default_name()}</span>
        </p>
        <p className="shrink-0 text-xs text-muted-foreground">
          {streak}
          {stats?.goal === 'weekly'
            ? ` · ${m.habit_week_progress({ done: stats.period_done, target: stats.period_target })}`
            : ''}
        </p>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        {stats ? (
          <div className="flex gap-1">
            {weekColumns(stats.today, stats.week_start, weeks).map((week) => (
              <div key={week[0]?.date} className="flex flex-col gap-1">
                {week.map(({ date, future }) => {
                  const done = checked.has(date)
                  const editable = !future && date >= earliest
                  return (
                    <button
                      key={date}
                      type="button"
                      disabled={!editable}
                      aria-pressed={done}
                      aria-label={(done ? m.habit_cell_checked : m.habit_cell_unchecked)({
                        date: formatDate(date),
                      })}
                      onClick={() => press(date, done)}
                      className={cn(
                        'rounded-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default',
                        CELL[size === 'm' || size === 'l' ? size : 'xl'],
                        !done && 'bg-muted',
                        future && 'opacity-30',
                        date === stats.today && 'ring-2 ring-foreground/40',
                      )}
                      style={done ? { backgroundColor: color } : undefined}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {burst ? <Burst color={color} onDone={() => setBurst(false)} /> : null}
      {dialog}
    </div>
  )
}
