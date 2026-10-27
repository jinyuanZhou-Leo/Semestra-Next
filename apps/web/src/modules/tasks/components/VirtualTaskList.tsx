import type { Task } from '@semestra/api-client'
import {
  defaultRangeExtractor,
  elementScroll,
  measureElement,
  observeElementOffset,
  observeElementRect,
  useVirtualizer,
} from '@tanstack/react-virtual'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { listOffset, scrollParent } from '@/lib/scroll'

/** Row heights before they are measured: a title alone, or a title over a line of details. */
const ROW_HEIGHT = 44
const ROW_HEIGHT_WITH_META = 66
const OVERSCAN = 10

export type VirtualRow = {
  index: number
  /** How many tasks the list has, for `aria-setsize`. */
  count: number
  measure: (node: Element | null) => void
}

type RowCache = {
  renderRow: (task: Task, row: VirtualRow) => ReactNode
  tasks: readonly Task[]
  rows: Map<string, ReactNode>
}

/** A request to bring a row into view: a new object per arrow key, not the selection itself. */
export type ScrollRequest = { id: string }

/** Mirrors `TaskRow`'s second line (note, due date or course). */
function estimate(task: Task | undefined): number {
  if (!task) return ROW_HEIGHT
  return task.notes.trim() || task.due_date || task.course_id ? ROW_HEIGHT_WITH_META : ROW_HEIGHT
}

/**
 * A task list that renders only the rows near the screen (500 tasks were ~11 000 DOM nodes and
 * made every keystroke on the page slow). The page column scrolls, not the list, so offsets are
 * taken relative to where the list starts. `keepId` (the row being edited or dragged) and the row
 * holding focus stay rendered when scrolled away; `scrollTo` brings a row into view.
 */
export function VirtualTaskList({
  tasks,
  keepId,
  scrollTo,
  renderRow,
}: {
  tasks: readonly Task[]
  keepId?: string | null
  scrollTo?: ScrollRequest | null
  renderRow: (task: Task, row: VirtualRow) => ReactNode
}) {
  const listRef = useRef<HTMLUListElement>(null)
  const scrollerRef = useRef<Element | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const kept = [keepId, focusedId]
    .map((id) => (id ? tasks.findIndex((task) => task.id === id) : -1))
    .filter((index) => index >= 0)

  // The React Compiler leaves this component uncompiled: the virtualizer is one mutable object
  // that re-renders it on scroll, and cached reads from it would go stale.
  // oxlint-disable-next-line react/incompatible-library -- see above
  const virtualizer = useVirtualizer({
    count: tasks.length,
    getItemKey: (index) => tasks[index]?.id ?? index,
    estimateSize: (index) => estimate(tasks[index]),
    overscan: OVERSCAN,
    // A row with no layout (hidden, or in tests) keeps its estimate instead of collapsing to 0.
    measureElement: (element, entry, instance) =>
      measureElement(element, entry, instance) ||
      estimate(tasks[Number(element.getAttribute('data-index'))]),
    // Scrolling re-renders in the next frame, not synchronously inside the scroll event.
    useFlushSync: false,
    getScrollElement: () => {
      if (!scrollerRef.current) scrollerRef.current = scrollParent(listRef.current)
      return scrollerRef.current
    },
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
      const indexes = new Set(defaultRangeExtractor(range))
      for (const index of kept) indexes.add(index)
      return [...indexes].sort((a, b) => a - b)
    },
  })

  useEffect(() => {
    if (!scrollTo) return
    const index = tasks.findIndex((task) => task.id === scrollTo.id)
    if (index < 0) return
    const rendered = listRef.current?.querySelector(`:scope > [data-index="${index}"]`)
    if (rendered) {
      rendered.scrollIntoView({ block: 'nearest' })
      return
    }
    // Not rendered: centre the place it will take, and it renders there.
    const scroller = scrollerRef.current
    const item = virtualizer.measurementsCache[index]
    if (!scroller || !item) return
    scroller.scrollTop =
      listOffset(listRef.current, scroller) + item.start - (scroller.clientHeight - item.size) / 2
    // Only a new request scrolls; the list changing under the selection does not.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTo])

  // The row holding focus (its menu, the editor) stays rendered while scrolled away.
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target instanceof Element ? event.target : null
      setFocusedId(target?.closest<HTMLElement>('[data-task-id]')?.dataset.taskId ?? null)
    }
    const onFocusOut = (event: FocusEvent) => {
      if (!list.contains(event.relatedTarget as Node | null)) setFocusedId(null)
    }
    list.addEventListener('focusin', onFocusIn)
    list.addEventListener('focusout', onFocusOut)
    return () => {
      list.removeEventListener('focusin', onFocusIn)
      list.removeEventListener('focusout', onFocusOut)
    }
  }, [])

  // Scrolling re-renders this list but nothing its rows show, so each row's element is kept and
  // React skips it. A new `renderRow` (the page re-rendered) or a new list starts over.
  const cache = useRef<RowCache | null>(null)
  if (cache.current?.renderRow !== renderRow || cache.current.tasks !== tasks) {
    cache.current = { renderRow, tasks, rows: new Map() }
  }
  const rows = cache.current.rows
  // A task keeps its `VirtualRow` while its place is the same, so a row that is rendered again
  // with nothing of its own changed is skipped (`TaskRow` is a `memo`).
  const places = useRef(new Map<string, VirtualRow>())
  const row = (index: number) => {
    const task = tasks[index]
    if (!task) return null
    let node = rows.get(task.id)
    if (node === undefined) {
      let place = places.current.get(task.id)
      if (place?.index !== index || place.count !== tasks.length) {
        place = { index, count: tasks.length, measure: virtualizer.measureElement }
        places.current.set(task.id, place)
      }
      node = renderRow(task, place)
      rows.set(task.id, node)
    }
    return node
  }

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
      {items.map((item, i) => {
        // A kept row far from the others gets a spacer before it, not the rows in between.
        const previous = items[i - 1]
        const gap = previous ? item.start - previous.end : 0
        return [
          gap > 0 ? <li key={`gap-${item.key}`} aria-hidden style={{ height: gap }} /> : null,
          row(item.index),
        ]
      })}
    </ul>
  )
}
