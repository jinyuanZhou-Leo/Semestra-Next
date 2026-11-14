type Span = { start: number; size: number }

/**
 * Where a scrolling strip must be scrolled to so `item` is in view: the current position when it
 * already is, otherwise the nearest one that shows it (its start when it is wider than the view).
 * `view.start` is the strip's scroll position and `item.start` the item's offset in its content.
 *
 * For moving one strip only. `Element.scrollIntoView` scrolls every scrolling ancestor as well,
 * which pulls a page that was scrolled down back up to the strip.
 */
export function scrollToReveal(view: Span, item: Span): number {
  if (item.start < view.start || item.size > view.size) return item.start
  const end = item.start + item.size
  return end > view.start + view.size ? end - view.size : view.start
}
