/** Helpers for lists virtualized inside the app shell's scrolling column. */

/** The nearest ancestor that scrolls (the app shell's content column), else the page. */
export function scrollParent(node: Element | null): Element | null {
  if (!node) return null
  for (let el = node.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el)
    if (overflowY === 'auto' || overflowY === 'scroll') return el
  }
  return document.scrollingElement ?? document.documentElement
}

/** Where a list starts in the scrolled content (whatever sits above it in the scroller). */
export function listOffset(list: Element | null, scroller: Element | null): number {
  if (!list || !scroller) return 0
  return (
    list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
  )
}
