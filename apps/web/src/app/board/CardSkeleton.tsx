import { createContext, use } from 'react'
import { m } from '@/paraglide/messages'
import { Skeleton } from '@/ui/skeleton'
import type { CardSize, CardSkeletonShape } from '../extensions'

/** The shape and size of the card being rendered, set by its frame. */
export const CardSkeletonContext = createContext<{ shape: CardSkeletonShape; size: CardSize }>({
  shape: 'list',
  size: 'm',
})

// Enough rows or tiles to fill the tallest card; the card body clips the rest.
const ROWS = [72, 56, 84, 64, 48, 76, 60, 80, 52, 68]

/**
 * What a card shows while its code or data loads, in the shape its manifest declares (`list`
 * rows, `stat` numbers, a `chart` area or `text` lines), filling the card body. It fades in after
 * a moment so data that arrives quickly never flashes a skeleton.
 */
export function CardSkeleton() {
  const { shape, size } = use(CardSkeletonContext)
  return (
    <output
      aria-busy
      className="flex min-h-0 flex-1 flex-col overflow-hidden animate-in fade-in fill-mode-backwards delay-150 duration-300 motion-reduce:animate-none"
    >
      <span className="sr-only">{m.common_loading()}</span>
      <Shape shape={shape} size={size} />
    </output>
  )
}

function Shape({ shape, size }: { shape: CardSkeletonShape; size: CardSize }) {
  if (shape === 'stat') {
    return (
      <div aria-hidden className="grid grid-flow-col auto-cols-fr gap-3">
        {/* One number per card, a row of them on the widest. */}
        {Array.from({ length: size === 'xl' ? 4 : 1 }, (_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-16 rounded-full" />
            <Skeleton className="h-8 w-20 rounded-lg" />
          </div>
        ))}
      </div>
    )
  }
  if (shape === 'chart') {
    return <Skeleton aria-hidden className="min-h-0 flex-1 rounded-xl" />
  }
  if (shape === 'text') {
    return (
      <div aria-hidden className="space-y-2.5 pt-1">
        {ROWS.map((width, i) => (
          <Skeleton key={i} className="h-3 rounded-full" style={{ width: `${width}%` }} />
        ))}
      </div>
    )
  }
  return (
    <ul aria-hidden className="space-y-1">
      {ROWS.map((width, i) => (
        <li key={i} className="flex h-8 items-center gap-2 px-1">
          <Skeleton className="size-4 shrink-0 rounded-md" />
          <Skeleton className="h-3 rounded-full" style={{ width: `${width}%` }} />
        </li>
      ))}
    </ul>
  )
}
