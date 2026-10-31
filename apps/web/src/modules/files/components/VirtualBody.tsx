import {
  elementScroll,
  measureElement,
  observeElementOffset,
  observeElementRect,
  useVirtualizer,
} from '@tanstack/react-virtual'
import { type ReactNode, useRef } from 'react'
import { listOffset, scrollParent } from '@/lib/scroll'
import { TableBody } from '@/ui/table'

const ROW_HEIGHT = 45
const OVERSCAN = 12

/**
 * The file rows of a long list as their own table body, with spacer rows standing in for those
 * off screen. The page's scrolling column scrolls them (the table's wrapper only scrolls sideways).
 */
export function VirtualBody({
  count,
  scrollerOf,
  renderRow,
}: {
  count: number
  scrollerOf: { current: HTMLElement | null }
  renderRow: (index: number, measure: (node: Element | null) => void) => ReactNode
}) {
  const body = useRef<HTMLTableSectionElement>(null)
  const scroller = useRef<Element | null>(null)
  // The React Compiler leaves this component uncompiled: the virtualizer is one mutable object
  // that re-renders it on scroll, and cached reads from it would go stale.
  // oxlint-disable-next-line react/incompatible-library -- see above
  const virtualizer = useVirtualizer({
    count,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    // A row with no layout (hidden, or in tests) keeps its estimate instead of collapsing to 0.
    measureElement: (element, entry, instance) =>
      measureElement(element, entry, instance) || ROW_HEIGHT,
    useFlushSync: false,
    getScrollElement: () => {
      // The nearest scroller above the table's frame (the table's own container only scrolls sideways).
      if (!scroller.current) scroller.current = scrollParent(scrollerOf.current)
      return scroller.current
    },
    // A scroller with no height yet (or no layout at all, as in tests) counts as the window's.
    observeElementRect: (instance, onChange) =>
      observeElementRect(instance, (rect) =>
        onChange(rect.height > 0 ? rect : { width: rect.width, height: window.innerHeight }),
      ),
    observeElementOffset: (instance, onChange) =>
      observeElementOffset(instance, (offset, isScrolling) =>
        onChange(offset - listOffset(body.current, instance.scrollElement), isScrolling),
      ),
    scrollToFn: (offset, options, instance) =>
      elementScroll(offset + listOffset(body.current, instance.scrollElement), options, instance),
  })
  const items = virtualizer.getVirtualItems()
  const before = items[0]?.start ?? 0
  const after = virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0)
  return (
    <TableBody ref={body}>
      {before > 0 ? <tr aria-hidden style={{ height: before }} /> : null}
      {items.map((item) => renderRow(item.index, virtualizer.measureElement))}
      {after > 0 ? <tr aria-hidden style={{ height: after }} /> : null}
    </TableBody>
  )
}
