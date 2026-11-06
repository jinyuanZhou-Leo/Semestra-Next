import 'react-pdf/dist/Page/TextLayer.css'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import { measureElement, observeElementRect, useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import { m } from '@/paraglide/messages'
import { Alert, AlertDescription } from '@/ui/alert'
import { Input } from '@/ui/input'
import { Spinner } from '@/ui/spinner'
import { highlightHtml } from '../highlight'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

// Copied next to the app by vite.config.ts: CJK PDFs need the character maps, scanned PDFs the
// JBIG2 and JPEG 2000 decoders (wasm) and colour profiles.
const OPTIONS = {
  cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`,
  standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`,
  wasmUrl: `${import.meta.env.BASE_URL}pdfjs/wasm/`,
  iccUrl: `${import.meta.env.BASE_URL}pdfjs/iccs/`,
  withCredentials: true,
  // The app's CSP has no 'unsafe-eval'; pdf.js has a slower path without it.
  isEvalSupported: false,
}

const MAX_WIDTH = 960
const PADDING = 16
const GAP = 16
// A4 portrait until the first page says otherwise.
const DEFAULT_RATIO = 297 / 210
// Stable, so a page's text renderer keeps its identity across scroll renders.
const NO_TERMS: readonly string[] = []

/**
 * The whole document as one vertical scroll, fitted to the width, with search terms highlighted
 * (M07 §6.1). Only the pages near the viewport are rendered; the rest hold their estimated height
 * (from the first page's shape) until they are measured.
 */
export function PdfViewer({
  url,
  initialPage = 1,
  terms = NO_TERMS,
}: {
  url: string
  initialPage?: number
  terms?: readonly string[]
}) {
  const [pageCount, setPageCount] = useState(0)
  const [ratio, setRatio] = useState(DEFAULT_RATIO)
  const [width, setWidth] = useState<number>()
  // What the page box shows while it is being edited; otherwise it follows the scroll.
  const [draft, setDraft] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const pageWidth = Math.min(Math.max((width ?? 0) - 2 * PADDING, 240), MAX_WIDTH)
  const pageHeight = Math.round(pageWidth * ratio)

  // The React Compiler leaves this component uncompiled: the virtualizer is one mutable object
  // that re-renders it on scroll, and cached reads from it would go stale.
  // oxlint-disable-next-line react/incompatible-library -- see above
  const virtualizer = useVirtualizer({
    count: pageCount,
    getScrollElement: () => scroller.current,
    estimateSize: () => pageHeight + GAP,
    overscan: 2,
    paddingStart: PADDING,
    paddingEnd: PADDING - GAP,
    // A page with no layout (in tests) keeps its estimate instead of collapsing to 0.
    measureElement: (element, entry, instance) =>
      measureElement(element, entry, instance) || pageHeight + GAP,
    // A scroller with no height yet (or no layout at all, as in tests) counts as the window's.
    observeElementRect: (instance, onChange) =>
      observeElementRect(instance, (rect) => {
        setWidth(Math.floor(rect.width))
        onChange(rect.height > 0 ? rect : { width: rect.width, height: window.innerHeight })
      }),
    useFlushSync: false,
  })

  // A new width or page shape changes every estimate.
  useEffect(() => virtualizer.measure(), [virtualizer, pageHeight])

  // Open on the requested page (a search hit or citation) once the pages are laid out.
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current || pageCount === 0) return
    opened.current = true
    const index = Math.min(Math.max(initialPage, 1), pageCount) - 1
    if (index > 0) virtualizer.scrollToIndex(index, { align: 'start' })
  }, [virtualizer, pageCount, initialPage])

  const items = virtualizer.getVirtualItems()
  // The page under the top third of the viewport.
  const probe = (virtualizer.scrollOffset ?? 0) + (virtualizer.scrollRect?.height ?? 0) / 3
  const current = (items.find((item) => item.end > probe) ?? items.at(-1))?.index ?? 0

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <form
        className="flex h-8 shrink-0 items-center justify-center gap-1.5 text-sm"
        onSubmit={(event) => {
          event.preventDefault()
          const n = Number(draft)
          if (Number.isInteger(n) && pageCount > 0) {
            virtualizer.scrollToIndex(Math.min(Math.max(n, 1), pageCount) - 1, { align: 'start' })
          }
          setDraft(null)
        }}
      >
        <Input
          aria-label={m.files_preview_page()}
          inputMode="numeric"
          className="h-7 w-14 text-center tabular-nums"
          value={draft ?? String(pageCount > 0 ? current + 1 : initialPage)}
          onFocus={(event) => {
            setDraft(event.target.value)
            event.target.select()
          }}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => setDraft(null)}
        />
        <span className="text-muted-foreground tabular-nums">
          {m.files_preview_page_of({ total: pageCount || '…' })}
        </span>
      </form>
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto rounded-lg bg-muted/50">
        <Document
          file={url}
          options={OPTIONS}
          externalLinkTarget="_blank"
          externalLinkRel="noopener noreferrer"
          suspense={false}
          onLoadSuccess={(pdf) => {
            // Estimate every page from the first one's shape before laying them out, so opening
            // on a later page lands there; rendered pages are measured.
            const show = (shape = DEFAULT_RATIO) => {
              setRatio(shape)
              setPageCount(pdf.numPages)
            }
            pdf.getPage(1).then(
              (first) => {
                const { width: w, height: h } = first.getViewport({ scale: 1 })
                show(w > 0 && h > 0 ? h / w : undefined)
              },
              () => show(),
            )
          }}
          loading={
            <div className="flex h-64 items-center justify-center">
              <Spinner />
            </div>
          }
          error={
            <Alert variant="destructive" className="m-4 w-auto">
              <AlertDescription>{m.files_preview_failed()}</AlertDescription>
            </Alert>
          }
        >
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {items.map((item) => (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className="absolute top-0 left-0 flex w-full justify-center"
                style={{ transform: `translateY(${item.start}px)`, paddingBottom: GAP }}
              >
                <PdfPage
                  pageNumber={item.index + 1}
                  width={pageWidth}
                  height={pageHeight}
                  terms={terms}
                />
              </div>
            ))}
          </div>
        </Document>
      </div>
    </div>
  )
}

/**
 * One page. Its own (compiled) component so the text renderer keeps its identity while the
 * viewer re-renders on every scroll: react-pdf rebuilds a page's text layer when it changes.
 */
function PdfPage({
  pageNumber,
  width,
  height,
  terms,
}: {
  pageNumber: number
  width: number
  height: number
  terms: readonly string[]
}) {
  return (
    <Page
      pageNumber={pageNumber}
      width={width}
      customTextRenderer={({ str }) => highlightHtml(str, terms)}
      loading={
        <div className="flex items-center justify-center bg-background" style={{ width, height }}>
          <Spinner />
        </div>
      }
      error={
        <Alert variant="destructive" className="w-auto">
          <AlertDescription>{m.files_preview_failed()}</AlertDescription>
        </Alert>
      }
      className="shadow-sm"
    />
  )
}
