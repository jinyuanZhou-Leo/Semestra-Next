import type { CardProps } from '@/app/extensions'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { getLocale } from '@/paraglide/runtime'
import { formatSpan } from '../plugin-kit/duration'
import type { WorldClockSettings } from './schema'
import { useClock } from './useClock'
import { formatZoneDate, formatZoneTime, localZone, offsetFrom, zoneLabel } from '@/lib/zones'

function offsetText(minutes: number): string {
  if (minutes === 0) return m.world_clock_same_time()
  const span = formatSpan(Math.abs(minutes) * 60)
  return minutes > 0 ? m.world_clock_ahead({ span }) : m.world_clock_behind({ span })
}

/** World clock (M14 §5): the time and date in up to three zones (one at the small size). */
export default function WorldClockCard({ size, settings }: CardProps<WorldClockSettings>) {
  const now = useClock(settings.show_seconds)
  const locale = getLocale()
  const local = localZone()
  const chosen = settings.zones.length > 0 ? settings.zones : [local]
  const zones = size === 's' ? chosen.slice(0, 1) : chosen

  return (
    <div className="flex h-full flex-col gap-2">
      {settings.label ? (
        <p className="truncate text-sm text-muted-foreground">{settings.label}</p>
      ) : null}
      <ul
        className={cn(
          'grid min-h-0 flex-1 items-center gap-3',
          zones.length === 2 && 'grid-cols-2',
          zones.length >= 3 && 'grid-cols-3',
        )}
      >
        {zones.map((tz) => (
          <li key={tz} className="min-w-0 text-center">
            <p className="truncate text-xs text-muted-foreground">{zoneLabel(tz, locale)}</p>
            <time
              dateTime={now.toISOString()}
              className={cn(
                'block font-heading font-semibold tabular-nums',
                size === 's' || zones.length > 1 ? 'text-2xl' : 'text-4xl',
              )}
            >
              {formatZoneTime(now, tz, locale, { seconds: settings.show_seconds })}
            </time>
            <p className="truncate text-xs text-muted-foreground">
              {formatZoneDate(now, tz, locale)}
              {settings.show_offset && tz !== local
                ? ` · ${offsetText(offsetFrom(now, tz, local))}`
                : ''}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}
