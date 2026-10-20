import type { Task } from '@semestra/api-client'
import {
  defaultRangeExtractor,
  elementScroll,
  observeElementOffset,
  observeElementRect,
  useVirtualizer,
} from '@tanstack/react-virtual'
import { type ReactNode, useEffect, useRef } from 'react'

/** A one-line row; rows are measured as they render, so taller ones only need a first guess. */
const ROW_ESTIMATE = 48
const OVERSCAN = 10

export type VirtualRow = { index: number; measure: (node: Element | null) => void }

/** The nearest ancestor that scrolls (the app shell's content column), else the page. */
function scrollParent(node: Element | null): Element | null {
  if (!node) return null
  for (let el = node.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el)
    if (overflowY === 'auto' || overflowY === 'scroll') return el
  }
  return document.scrollingElement ?? document.documentElement
}

/** Where the list starts in the scrolled content (the add box and header sit above it). */
function listOffset(list: Element | null, scroller: Element | null): number {
  if (!list || !scroller) return 0
  return (
    list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
  )
}

/**
 * A task list that renders only the rows near the screen (500 tasks were ~11 000 DOM nodes and
 * made every keystroke on the page slow). The page column scrolls, not the list, so offsets are
 * taken relative to where the list starts. `keepId` (the row being edited or dragged) stays
 * rendered when scrolled away; `scrollToId` (the selected row) is scrolled into view.
 */
export function VirtualTaskList({
  tasks,
  keepId,
  scrollToId,
  renderRow,
}: {
  tasks: readonly Task[]
  keepId?: string | null
  scrollToId?: string | null
  renderRow: (task: Task, row: VirtualRow) => ReactNode
}) {
  const listRef = useRef<HTMLUListElement>(null)
  const keep = keepId ? tasks.findIndex((task) => task.id === keepId) : -1
  // The React Compiler leaves this component uncompiled: the virtualizer is one mutable object
  // that re-renders it on scroll, and cached reads from it would go stale.
  // oxlint-disable-next-line react/incompatible-library -- see above
  const virtualizer = useVirtualizer({
    count: tasks.length,
    getItemKey: (index) => tasks[index]?.id ?? index,
    estimateSize: () => ROW_ESTIMATE,
    overscan: OVERSCAN,
    getScrollElement: () => scrollParent(listRef.current),
    // A scroller with no height yet (or no layout at all, as in tests) counts as the window's.
    observeElementRect: (instance, onChange) =>
      observeElementRect(instance, (rect) =>
        onChange(rect.height > 0 ? rect : { width: rect.width, height: window.innerHeight }),
      ),
    observeElementOffset: (instance, onChange) =>
      observeElementOffset(instance, (offset, isScrolling) =>
        onChange(offset - listOffset(listRef.current, instance.scrollElement), isScrolling),
      ),
    scrollToFn: (offset, options, instance) =>
      elementScroll(
        offset + listOffset(listRef.current, instance.scrollElement),
        options,
        instance,
      ),
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range)
      if (keep < 0 || indexes.includes(keep)) return indexes
      // Rows sit in normal flow between two spacers, so the kept row brings the ones between.
      const from = Math.min(keep, indexes[0] ?? keep)
      const to = Math.max(keep, indexes.at(-1) ?? keep)
      return Array.from({ length: to - from + 1 }, (_, i) => from + i)
    },
  })

  const scrollIndex = scrollToId ? tasks.findIndex((task) => task.id === scrollToId) : -1
  useEffect(() => {
    if (scrollIndex >= 0) virtualizer.scrollToIndex(scrollIndex, { align: 'auto' })
  }, [scrollIndex, virtualizer])

  const items = virtualizer.getVirtualItems()
  const last = items.at(-1)
  return (
    <ul
      ref={listRef}
      style={{
        paddingTop: items[0]?.start ?? 0,
        paddingBottom: last ? virtualizer.getTotalSize() - last.end : 0,
      }}
    >
      {items.map((item) => {
        const task = tasks[item.index]
        return task
          ? renderRow(task, { index: item.index, measure: virtualizer.measureElement })
          : null
      })}
    </ul>
  )
}
