import { Minus, Plus } from 'lucide-react'
import { useEffect } from 'react'
import type { CardProps } from '@/app/extensions'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Ring } from '../plugin-kit/Ring'
import { useCardSettings } from '../plugin-kit/useCardSettings'
import { currentValue, ratio, stepped } from './counter'
import { registerReset } from './resetBus'
import type { CounterSettings } from './schema'

/** Counter card (M14 §1): a count between a minimum and a maximum, optionally as a ring. */
export default function CounterCard({ instanceId, size, settings }: CardProps<CounterSettings>) {
  const { value: current, update } = useCardSettings(instanceId, settings, 300)
  const initial = current.initial
  useEffect(
    () => registerReset(instanceId, () => update({ value: initial })),
    [instanceId, update, initial],
  )
  const count = currentValue(current)
  const label = current.label || m.counter_default_label()
  const showRing = current.show_ring && size !== 's'

  const step = (direction: 1 | -1) => update({ value: stepped(current, direction) })

  const controls = (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="icon"
        aria-label={m.counter_decrease({ label })}
        disabled={count <= current.min}
        onClick={() => step(-1)}
      >
        <Minus aria-hidden />
      </Button>
      <Button
        size="icon"
        aria-label={m.counter_increase({ label })}
        disabled={count >= current.max}
        onClick={() => step(1)}
      >
        <Plus aria-hidden />
      </Button>
    </div>
  )

  const number = (
    <output
      aria-live="polite"
      aria-label={m.counter_value({ label, value: count })}
      className={cn(
        'font-heading font-semibold tabular-nums',
        size === 's' ? 'text-4xl' : 'text-3xl',
      )}
    >
      {count}
    </output>
  )

  return (
    <div className="relative flex h-full flex-col justify-between gap-2">
      <p className="min-w-0 truncate text-sm text-muted-foreground" title={label}>
        {label}
      </p>
      {showRing ? (
        <div className="flex min-h-0 flex-1 items-center justify-between gap-3">
          <Ring ratio={ratio(current)} className="h-full max-h-24" strokeWidth={9}>
            {number}
          </Ring>
          {controls}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-between gap-2">
          {number}
          {controls}
        </div>
      )}
    </div>
  )
}
