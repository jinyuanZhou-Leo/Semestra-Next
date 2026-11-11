import { filesDocumentReadOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import type { PageTarget } from '../page-target'
import { Markdown } from './Markdown'
import { PageControls } from './PageControls'

const READ_WINDOW = 30
const HIGHLIGHT = 'files-preview-search'

function pageId(itemId: string, page: number) {
  return `files-page-${itemId}-${page}`
}

/**
 * The text the pipeline read from a file, page by page (M07 §6.1): Word, PowerPoint, Excel and
 * HTML files, and the "Recognized text" view of a PDF. Thirty pages at a time, starting near the
 * requested page; search terms are highlighted and the page bar floats at the bottom.
 */
export function DocumentText({
  itemId,
  target,
  terms,
  onNavigate,
  onPageChange,
}: {
  itemId: string
  target?: PageTarget
  terms: readonly string[]
  /** The page bar asks for a page; it comes back as `target`. */
  onNavigate: (page: number) => void
  onPageChange?: (page: number) => void
}) {
  const startOf = (page: number) => Math.max(1, page - 2)
  const [from, setFrom] = useState(startOf(target?.page ?? 1))
  const [current, setCurrent] = useState(target?.page ?? 1)
  // A page outside the loaded window moves the window there.
  const [shownTarget, setShownTarget] = useState(target)
  if (target !== shownTarget) {
    setShownTarget(target)
    if (target && (target.page < from || target.page >= from + READ_WINDOW)) {
      setFrom(startOf(target.page))
    }
  }
  const query = useQuery({
    ...filesDocumentReadOptions({
      path: { item_id: itemId },
      query: { page_from: from, page_to: from + READ_WINDOW - 1 },
    }),
    staleTime: Infinity,
  })
  const scroller = useRef<HTMLDivElement>(null)

  // Search terms are marked with the CSS Custom Highlight API (styled by
  // `::highlight(files-preview-search)` in theme.css), so the rendered Markdown is left as it is.
  useEffect(() => {
    const element = scroller.current
    if (!element || !query.data || typeof CSS === 'undefined' || !('highlights' in CSS)) return
    const needles = terms.map((t) => t.toLowerCase()).filter(Boolean)
    if (needles.length === 0) return
    const ranges: Range[] = []
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent ?? '').toLowerCase()
      for (const needle of needles) {
        for (
          let at = text.indexOf(needle);
          at !== -1;
          at = text.indexOf(needle, at + needle.length)
        ) {
          const range = new Range()
          range.setStart(node, at)
          range.setEnd(node, at + needle.length)
          ranges.push(range)
        }
      }
    }
    CSS.highlights.set(HIGHLIGHT, new Highlight(...ranges))
    return () => {
      CSS.highlights.delete(HIGHLIGHT)
    }
  }, [terms, query.data])

  // Bring each requested page into view once, when it has rendered (not again on a refetch).
  const scrolledTo = useRef<PageTarget | undefined>(undefined)
  useEffect(() => {
    if (!query.data || !target || target === scrolledTo.current) return
    const section = document.getElementById(pageId(itemId, target.page))
    if (!section) return
    section.scrollIntoView()
    scrolledTo.current = target
  }, [query.data, itemId, target])

  // Earlier or later pages: load them from `page` and show that page.
  const turnTo = (page: number) => {
    setFrom(page)
    onNavigate(page)
  }

  // The page being read is the topmost one in view.
  useEffect(() => {
    const root = scroller.current
    if (!root || !query.data || typeof IntersectionObserver === 'undefined') return
    const visible = new Map<number, boolean>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visible.set(Number((entry.target as HTMLElement).dataset.page), entry.isIntersecting)
        }
        const top = [...visible].filter(([, shown]) => shown).map(([page]) => page)
        if (top.length > 0) setCurrent(Math.min(...top))
      },
      { root, rootMargin: '0px 0px -66% 0px' },
    )
    root.querySelectorAll('[data-page]').forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [query.data])

  useEffect(() => {
    onPageChange?.(current)
  }, [onPageChange, current])

  const total = query.data?.page_count ?? 0
  return (
    <>
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
        <AsyncBoundary query={query}>
          {(doc) => (
            <div className="mx-auto max-w-3xl space-y-6 px-6 pt-6 pb-24">
              {from > 1 ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => turnTo(Math.max(1, from - READ_WINDOW))}
                >
                  {m.files_preview_earlier_pages()}
                </Button>
              ) : null}
              {doc.pages.map((p) => (
                <section
                  key={p.page_no}
                  id={pageId(itemId, p.page_no)}
                  data-page={p.page_no}
                  className="scroll-mt-6 space-y-2 rounded-xl bg-background p-8 shadow-sm ring-1 ring-border"
                >
                  <p className="text-xs text-muted-foreground">
                    {m.files_preview_page_label({ page: p.page_no })}
                  </p>
                  <Markdown>{p.markdown}</Markdown>
                </section>
              ))}
              {doc.next_page ? (
                <Button variant="outline" size="sm" onClick={() => turnTo(doc.next_page ?? from)}>
                  {m.files_preview_later_pages()}
                </Button>
              ) : null}
            </div>
          )}
        </AsyncBoundary>
      </div>
      {total > 1 ? <PageControls page={current} total={total} onPage={onNavigate} /> : null}
    </>
  )
}
