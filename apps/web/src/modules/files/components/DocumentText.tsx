import { type DocumentPage, filesDocumentRead } from '@semestra/api-client'
import { observeElementRect, useVirtualizer } from '@tanstack/react-virtual'
import { useQueries, useQuery } from '@tanstack/react-query'
import { CircleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Skeleton } from '@/ui/skeleton'
import { showRanges, textRanges } from '../highlight'
import type { PageTarget } from '../page-target'
import { Markdown } from './Markdown'
import { PageControls } from './PageControls'

/** Pages read per request; the document is read in these runs as the reader reaches them. */
const CHUNK = 30
const HIGHLIGHT = 'files-preview-search'
// Height of a page that has not been read yet (and so not measured), and the space around pages.
const ESTIMATE = 360
const GAP = 24
const PADDING_START = 24
// Room for the floating page bar under the last page.
const PADDING_END = 96
// Pages beyond the viewport that are rendered (and so read) ahead of the reader.
const OVERSCAN = 2

const chunkOf = (page: number) => Math.floor((page - 1) / CHUNK)

function chunkOptions(itemId: string, chunk: number) {
  return {
    queryKey: ['files', 'document-text', itemId, chunk],
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const { data } = await filesDocumentRead({
        path: { item_id: itemId },
        query: { page_from: chunk * CHUNK + 1, page_to: (chunk + 1) * CHUNK },
        signal,
        throwOnError: true,
      })
      return data
    },
    staleTime: Infinity,
  }
}

/**
 * The text the pipeline read from a file, page by page (M07 §6.1): Word, PowerPoint, Excel and
 * HTML files, and the "Recognized text" view of a PDF. All pages are laid out as one scroll (the
 * page count comes with the first read); only the pages near the viewport are rendered, and the
 * thirty-page run each belongs to is read when the first of them comes near, so reading on in
 * either direction, or jumping to a page, needs no button. Search terms are highlighted and the
 * page bar floats at the bottom.
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
  // The run the document opens on: it tells the page count, the rest is read as it is reached.
  const [first] = useState(() => chunkOf(target?.page ?? 1))
  const query = useQuery(chunkOptions(itemId, first))
  return (
    <AsyncBoundary query={query}>
      {(doc) => (
        <TextPages
          itemId={itemId}
          pageCount={doc.page_count}
          target={target}
          terms={terms}
          onNavigate={onNavigate}
          onPageChange={onPageChange}
        />
      )}
    </AsyncBoundary>
  )
}

function TextPages({
  itemId,
  pageCount,
  target,
  terms,
  onNavigate,
  onPageChange,
}: {
  itemId: string
  pageCount: number
  target?: PageTarget
  terms: readonly string[]
  onNavigate: (page: number) => void
  onPageChange?: (page: number) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  // The React Compiler leaves this component uncompiled: the virtualizer is one mutable object
  // that re-renders it on scroll, and cached reads from it would go stale.
  // oxlint-disable-next-line react/incompatible-library -- see above
  const virtualizer = useVirtualizer({
    count: pageCount,
    getScrollElement: () => scroller.current,
    estimateSize: () => ESTIMATE,
    gap: GAP,
    overscan: OVERSCAN,
    paddingStart: PADDING_START,
    paddingEnd: PADDING_END,
    // A requested page lands with the same space above it as the first page has.
    scrollPaddingStart: PADDING_START,
    // A scroller with no height yet (or no layout at all, as in tests) counts as the window's.
    observeElementRect: (instance, onChange) =>
      observeElementRect(instance, (rect) =>
        onChange(rect.height > 0 ? rect : { width: rect.width, height: window.innerHeight }),
      ),
    useFlushSync: false,
  })
  const items = virtualizer.getVirtualItems()

  // The runs the rendered pages belong to; a page's own read failing shows on that page only.
  const chunks = [...new Set(items.map((item) => chunkOf(item.index + 1)))]
  const reads = useQueries({
    queries: chunks.map((chunk) => chunkOptions(itemId, chunk)),
  })
  const pageAt = new Map<number, DocumentPage>()
  const readOf = new Map<number, (typeof reads)[number]>()
  chunks.forEach((chunk, i) => {
    const read = reads[i]
    if (!read) return
    readOf.set(chunk, read)
    for (const page of read.data?.pages ?? []) pageAt.set(page.page_no, page)
  })

  // The page under the top third of the viewport is the one being read.
  const probe = (virtualizer.scrollOffset ?? 0) + (virtualizer.scrollRect?.height ?? 0) / 3
  const current = (items.find((item) => item.end > probe) ?? items.at(-1))?.index ?? 0
  useEffect(() => {
    onPageChange?.(current + 1)
  }, [onPageChange, current])

  // Go to each requested page (the one the preview opened on, a contents entry, a search hit, the
  // page box) once; the pages above it settle to their real heights without moving it.
  useEffect(() => {
    if (!target) return
    virtualizer.scrollToIndex(Math.min(Math.max(target.page, 1), pageCount) - 1, {
      align: 'start',
    })
  }, [virtualizer, pageCount, target])

  return (
    <>
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
        <div
          className="relative mx-auto w-full max-w-3xl px-6"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {items.map((item) => {
            const page = pageAt.get(item.index + 1)
            const read = readOf.get(chunkOf(item.index + 1))
            return (
              <div
                key={item.key}
                ref={virtualizer.measureElement}
                data-index={item.index}
                className="absolute top-0 left-6 w-[calc(100%-3rem)]"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <TextPage
                  number={item.index + 1}
                  page={page}
                  state={read?.isError ? 'failed' : read?.isSuccess ? 'read' : 'reading'}
                  onRetry={() => void read?.refetch()}
                  terms={terms}
                />
              </div>
            )
          })}
        </div>
      </div>
      {pageCount > 1 ? (
        <PageControls page={current + 1} total={pageCount} onPage={onNavigate} />
      ) : null}
    </>
  )
}

/** One page: its text, a placeholder while it is being read, or the failure to read it. */
function TextPage({
  number,
  page,
  state,
  onRetry,
  terms,
}: {
  number: number
  page?: DocumentPage
  state: 'reading' | 'read' | 'failed'
  onRetry: () => void
  terms: readonly string[]
}) {
  const section = useRef<HTMLElement>(null)
  // Search terms are marked with the CSS Custom Highlight API (`::highlight(files-preview-search)`
  // in theme.css), so the rendered Markdown is left as it is; a page marks only its own text.
  useEffect(() => {
    const element = section.current
    if (!element || !page) return
    return showRanges(HIGHLIGHT, textRanges(element, terms))
  }, [terms, page])

  return (
    <section
      ref={section}
      data-page={number}
      className="space-y-2 rounded-xl bg-background p-8 shadow-sm ring-1 ring-border"
      style={page || state === 'read' ? undefined : { minHeight: ESTIMATE }}
    >
      <p className="text-xs text-muted-foreground">
        {m.files_preview_page_label({ page: number })}
      </p>
      {page ? (
        <Markdown>{page.markdown}</Markdown>
      ) : state === 'read' ? null : state === 'failed' ? (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <CircleAlert aria-hidden className="size-4" />
          <span>{m.common_load_failed()}</span>
          <Button variant="outline" size="sm" onClick={onRetry}>
            {m.common_retry()}
          </Button>
        </div>
      ) : (
        <div aria-hidden className="space-y-3 pt-1">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      )}
    </section>
  )
}
