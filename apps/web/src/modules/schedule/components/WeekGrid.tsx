import { TriangleAlert } from 'lucide-react'
import type { CSSProperties } from 'react'
import { firstDayOfWeek, formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { weekdayName } from '../time'

/** One block on the grid; times are minutes after midnight in the Program's time zone. */
export type GridItem = {
  id: string
  weekday: number
  start: number
  end: number
  color: string
  title: string
  subtitle?: string
  cancelled?: boolean
  conflict?: boolean
  muted?: boolean
  onClick?: () => void
}

export type GridDay = { weekday: number; label: string; sublabel?: string; shaded?: boolean }

/** The days of a week in the user's week order (M11), without the weekend when asked. */
export function weekDays(showWeekends: boolean): GridDay[] {
  const first = firstDayOfWeek()
  const order = Array.from({ length: 7 }, (_, i) => ((first - 1 + i) % 7) + 1)
  return order
    .filter((d) => showWeekends || d < 6)
    .map((weekday) => ({ weekday, label: weekdayName(weekday, 'short') }))
}

export function minutes(time: string): number {
  const [h, mm] = time.split(':').map(Number)
  return (h ?? 0) * 60 + (mm ?? 0)
}

/** Side-by-side lanes for overlapping items of one day. */
function layout(items: GridItem[]): Map<string, { lane: number; lanes: number }> {
  const sorted = items.toSorted((a, b) => a.start - b.start || b.end - a.end)
  const out = new Map<string, { lane: number; lanes: number }>()
  let cluster: GridItem[] = []
  let laneEnds: number[] = []
  let clusterEnd = -1
  const flush = () => {
    for (const item of cluster) {
      const entry = out.get(item.id)
      if (entry) entry.lanes = laneEnds.length
    }
    cluster = []
    laneEnds = []
  }
  for (const item of sorted) {
    if (item.start >= clusterEnd) flush()
    let lane = laneEnds.findIndex((end) => end <= item.start)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(item.end)
    } else {
      laneEnds[lane] = item.end
    }
    out.set(item.id, { lane, lanes: 1 })
    cluster.push(item)
    clusterEnd = Math.max(clusterEnd, item.end)
  }
  flush()
  return out
}

/**
 * A static week grid without dates (M04 §5.2 timetable, §5.5 week card, §5.4 export): days as
 * columns, hours as rows, overlapping items side by side. The hour range widens to fit items
 * outside `dayStart`–`dayEnd`.
 */
export function WeekGrid({
  days,
  items,
  dayStart,
  dayEnd,
  hourHeight = 48,
  compact = false,
  hideCancelled = false,
  className,
  style,
}: {
  days: GridDay[]
  items: GridItem[]
  dayStart: number
  dayEnd: number
  hourHeight?: number
  compact?: boolean
  hideCancelled?: boolean
  className?: string
  style?: CSSProperties
}) {
  const shown = items.filter(
    (i) => (!hideCancelled || !i.cancelled) && days.some((d) => d.weekday === i.weekday),
  )
  const from = Math.floor(Math.min(dayStart, ...shown.map((i) => i.start)) / 60) * 60
  const to = Math.ceil(Math.max(dayEnd, ...shown.map((i) => i.end)) / 60) * 60
  const hours = Array.from({ length: Math.max(1, (to - from) / 60) }, (_, i) => from / 60 + i)
  const height = hours.length * hourHeight
  const top = (value: number) => ((value - from) / (to - from)) * height

  return (
    <div
      className={cn('grid text-xs', className)}
      style={{ gridTemplateColumns: `3rem repeat(${days.length}, minmax(0, 1fr))`, ...style }}
    >
      <div />
      {days.map((day) => (
        <div key={day.weekday} className="truncate px-1 pb-1 text-center font-medium">
          {day.label}
          {day.sublabel ? (
            <span className="block truncate font-normal text-muted-foreground">{day.sublabel}</span>
          ) : null}
        </div>
      ))}
      <div className="relative" style={{ height }}>
        {hours.map((h) => (
          <span
            key={h}
            className="absolute right-1 -translate-y-1/2 text-[0.7rem] text-muted-foreground tabular-nums"
            style={{ top: top(h * 60) }}
          >
            {h === from / 60 ? '' : formatTime(`${String(h % 24).padStart(2, '0')}:00`)}
          </span>
        ))}
      </div>
      {days.map((day) => {
        const dayItems = shown.filter((i) => i.weekday === day.weekday)
        const lanes = layout(dayItems)
        return (
          <div
            key={day.weekday}
            data-weekday={day.weekday}
            className={cn('relative border-l border-border', day.shaded && 'bg-muted/60')}
            style={{ height }}
          >
            {hours.map((h) => (
              <div
                key={h}
                aria-hidden
                className="absolute inset-x-0 border-t border-border/70"
                style={{ top: top(h * 60) }}
              />
            ))}
            {dayItems.map((item) => {
              const place = lanes.get(item.id) ?? { lane: 0, lanes: 1 }
              const Tag = item.onClick ? 'button' : 'div'
              return (
                <Tag
                  key={item.id}
                  type={item.onClick ? 'button' : undefined}
                  onClick={item.onClick}
                  data-testid="grid-item"
                  className={cn(
                    'absolute overflow-hidden rounded-md border-l-4 px-1 py-0.5 text-left leading-tight',
                    item.onClick && 'cursor-pointer hover:brightness-95',
                    item.muted && 'opacity-50',
                  )}
                  style={{
                    top: top(item.start) + 1,
                    height: Math.max(top(item.end) - top(item.start) - 2, 14),
                    left: `calc(${(place.lane / place.lanes) * 100}% + 2px)`,
                    width: `calc(${100 / place.lanes}% - 4px)`,
                    borderLeftColor: item.color,
                    backgroundColor: `color-mix(in oklab, ${item.color} 18%, var(--background))`,
                  }}
                >
                  <span
                    className={cn(
                      'flex items-center gap-1 font-medium',
                      item.cancelled && 'line-through opacity-70',
                    )}
                  >
                    {item.conflict ? (
                      <TriangleAlert
                        aria-label={m.schedule_conflict()}
                        className="size-3 shrink-0 text-destructive"
                      />
                    ) : null}
                    <span className="truncate">{item.title}</span>
                  </span>
                  {!compact && item.subtitle ? (
                    <span className="block truncate text-muted-foreground">{item.subtitle}</span>
                  ) : null}
                </Tag>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
