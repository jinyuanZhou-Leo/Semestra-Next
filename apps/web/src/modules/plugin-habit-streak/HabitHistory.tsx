import { useState } from 'react'
import { useElementWidth } from '@/app/board/media'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { HISTORY_WEEKS, type WeekStart, weekColumns } from './grid'

const CELL = { m: 10, l: 14 } as const
const GAP = 3

/**
 * The check-in history as a read-only grid of days, one column per week, ending with this week
 * (M14 §2). It shows as many weeks as fit its width; checking in stays on the ring.
 */
export function HabitHistory({
  today,
  weekStart,
  checked,
  color,
  size,
  className,
}: {
  today: string
  weekStart: WeekStart
  checked: ReadonlySet<string>
  color: string
  size: 'm' | 'l'
  className?: string
}) {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const width = useElementWidth(element)
  const cell = CELL[size]
  const weeks = Math.max(1, Math.min(HISTORY_WEEKS, Math.floor((width + GAP) / (cell + GAP))))
  const columns = width ? weekColumns(today, weekStart, weeks) : []
  const done = columns.flat().filter((day) => checked.has(day.date)).length

  return (
    <div ref={setElement} className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {width ? <p className="sr-only">{m.habit_history_label({ weeks, count: done })}</p> : null}
      <div aria-hidden className="flex justify-end" style={{ gap: GAP }}>
        {columns.map((week) => (
          <div key={week[0]?.date} className="flex flex-col" style={{ gap: GAP }}>
            {week.map(({ date, future }) => (
              <span
                key={date}
                title={(checked.has(date) ? m.habit_cell_checked : m.habit_cell_unchecked)({
                  date: formatDate(date),
                })}
                className={cn(
                  'rounded-[3px]',
                  !checked.has(date) && 'bg-muted',
                  future && 'opacity-30',
                  date === today && 'ring-2 ring-foreground/40',
                )}
                style={{
                  width: cell,
                  height: cell,
                  ...(checked.has(date) ? { backgroundColor: color } : {}),
                }}
              />
            ))}
          </div>
        ))}
      </div>
      {size === 'l' ? (
        <p aria-hidden className="text-right text-xs text-muted-foreground">
          {m.habit_history_weeks({ count: weeks })}
        </p>
      ) : null}
    </div>
  )
}
