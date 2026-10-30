import { m } from '@/paraglide/messages'
import { Skeleton } from '@/ui/skeleton'

/**
 * What a card shows while its code or data loads: one rounded block filling the card body, so the
 * card keeps its size. It fades in after a moment so data that arrives quickly never flashes it.
 */
export function CardSkeleton() {
  return (
    <output
      aria-busy
      className="flex min-h-0 flex-1 flex-col animate-in fade-in fill-mode-backwards delay-150 duration-300 motion-reduce:animate-none"
    >
      <span className="sr-only">{m.common_loading()}</span>
      <Skeleton aria-hidden className="min-h-0 flex-1 rounded-xl" />
    </output>
  )
}
