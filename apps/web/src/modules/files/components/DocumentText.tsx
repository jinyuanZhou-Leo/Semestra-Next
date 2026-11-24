import { filesDocumentRead } from '@semestra/api-client'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { m } from '@/paraglide/messages'
import { Skeleton } from '@/ui/skeleton'
import type { PageTarget } from '../page-target'
import { Markdown } from './Markdown'
import { PageControls } from './PageControls'

const READ_WINDOW = 30
const HIGHLIGHT = 'files-preview-search'
// How far from the edge of the scroll (in viewport heights) the next pages start loading.
const LOAD_AHEAD = '100% 0px'

function pageId(itemId: string, page: number) {
  return `files-page-${itemId}-${page}`
}

/** The pages to read: `from` to `to` (a window long, unless it ends where the loaded pages start). */
type Window = { from: number; to: number }

const windowFrom = (from: number): Window => ({ from, to: from + READ_WINDOW - 1 })

/** A page-sized placeholder at the edge of the loaded pages while more are to come. */
function PagePlaceholder({ edge }: { edge: 'earlier' | 'later' }) {
  return (
    <div
      data-edge={edge}
      aria-hidden
      className="space-y-3 rounded-xl bg-background p-8 shadow-sm ring-1 ring-border"
    >
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  )
}

/**
 * The text the pipeline read from a file, page by page (M07 §6.1): Word, PowerPoint, Excel and
 * HTML files, and the "Recognized text" view of a PDF. It reads thirty pages at a time, starting
 * near the requested page, and goes on in either direction as the reader nears the edge of what is
 * loaded; a page outside the loaded ones starts a new run there. Search terms are highlighted and
 * the page bar floats at the bottom.
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
  const [start, setStart] = useState(startOf(target?.page ?? 1))
  const [current, setCurrent] = useState(target?.page ?? 1)
  const query = useInfiniteQuery({
    queryKey: ['files', 'document-text', itemId, start],
    initialPageParam: windowFrom(start),
    queryFn: async ({ pageParam, signal }) => {
      const { data } = await filesDocumentRead({
        path: { item_id: itemId },
        query: { page_from: pageParam.from, page_to: pageParam.to },
        signal,
        throwOnError: true,
      })
      return data
    },
    getNextPageParam: (last) => (last.next_page ? windowFrom(last.next_page) : undefined),
    getPreviousPageParam: (first) => {
      const from = first.pages[0]?.page_no ?? 1
      return from > 1 ? { from: Math.max(1, from - READ_WINDOW), to: from - 1 } : undefined
    },
    // A new run (a jump) keeps showing the old pages until the new ones are there.
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    select: (data) => ({
      pageCount: data.pages[0]?.page_count ?? 0,
      pages: data.pages.flatMap((p) => p.pages),
    }),
  })
  const { fetchNextPage, fetchPreviousPage, hasNextPage, hasPreviousPage } = query
  const fetching = query.isFetchingNextPage || query.isFetchingPreviousPage
  const scroller = useRef<HTMLDivElement>(null)
  const firstLoaded = query.data?.pages[0]?.page_no
  const lastLoaded = query.data?.pages.at(-1)?.page_no

  // A page outside the loaded ones starts a new run there.
  const [shownTarget, setShownTarget] = useState(target)
  if (target !== shownTarget) {
    setShownTarget(target)
    if (
      target &&
      firstLoaded !== undefined &&
      lastLoaded !== undefined &&
      (target.page < firstLoaded || target.page > lastLoaded)
    ) {
      setStart(startOf(target.page))
    }
  }

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

  // Pages arrive above the ones being read: keep those where they were. (The browser's own scroll
  // anchoring is off for this scroller, so every browser does the same.)
  const before = useRef<{ top: number; height: number } | null>(null)
  useLayoutEffect(() => {
    const element = scroller.current
    const was = before.current
    if (!element || !was) return
    before.current = null
    element.scrollTop = was.top + (element.scrollHeight - was.height)
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- runs when pages arrive above
  }, [firstLoaded])

  // The pages around the loaded ones start loading when their placeholder comes near.
  const earlierEdge = useRef<HTMLDivElement>(null)
  const laterEdge = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = scroller.current
    if (!root || fetching || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          if (entry.target === earlierEdge.current) {
            before.current = { top: root.scrollTop, height: root.scrollHeight }
            void fetchPreviousPage()
          } else {
            void fetchNextPage()
          }
        }
      },
      { root, rootMargin: LOAD_AHEAD },
    )
    for (const edge of [earlierEdge.current, laterEdge.current]) if (edge) observer.observe(edge)
    return () => observer.disconnect()
    // Observed again after each load, so an edge still in range loads the next run.
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `firstLoaded`/`lastLoaded` re-observe
  }, [
    fetchNextPage,
    fetchPreviousPage,
    hasNextPage,
    hasPreviousPage,
    fetching,
    firstLoaded,
    lastLoaded,
  ])

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

  const total = query.data?.pageCount ?? 0
  return (
    <>
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto [overflow-anchor:none]">
        <AsyncBoundary query={query}>
          {(doc) => (
            <div className="mx-auto max-w-3xl space-y-6 px-6 pt-6 pb-24">
              {hasPreviousPage ? (
                <div ref={earlierEdge}>
                  <PagePlaceholder edge="earlier" />
                </div>
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
              {hasNextPage ? (
                <div ref={laterEdge}>
                  <PagePlaceholder edge="later" />
                </div>
              ) : null}
            </div>
          )}
        </AsyncBoundary>
      </div>
      {total > 1 ? <PageControls page={current} total={total} onPage={onNavigate} /> : null}
    </>
  )
}
