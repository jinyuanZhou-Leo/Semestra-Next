import 'react-pdf/dist/Page/TextLayer.css'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import { measureElement, observeElementRect, useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import { m } from '@/paraglide/messages'
import { Alert, AlertDescription } from '@/ui/alert'
import { Spinner } from '@/ui/spinner'
import { highlightHtml } from '../highlight'
import type { PageTarget } from '../page-target'
import { PageControls } from './PageControls'

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
 * The whole document as one vertical scroll, fitted to the width and zoomable, with search terms
 * highlighted (M07 §6.1). Only the pages near the viewport are rendered; the rest hold their
 * estimated height (from the first page's shape) until they are measured. The page bar floats at
 * the bottom; `target` scrolls to a page, `onPageChange` reports the page being read.
 */
export function PdfViewer({
  url,
  target,
  terms = NO_TERMS,
  onPageChange,
}: {
  url: string
  target?: PageTarget
  terms?: readonly string[]
  onPageChange?: (page: number) => void
}) {
  const [pageCount, setPageCount] = useState(0)
  const [ratio, setRatio] = useState(DEFAULT_RATIO)
  const [width, setWidth] = useState<number>()
  const [zoom, setZoom] = useState(1)
  const scroller = useRef<HTMLDivElement>(null)
  // The page to stay on while the zoom changes every page's size.
  const keep = useRef<number | null>(null)
  const fit = Math.min(Math.max((width ?? 0) - 2 * PADDING, 240), MAX_WIDTH)
  const pageWidth = Math.round(fit * zoom)
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
    // Room for the floating page bar under the last page.
    paddingEnd: PADDING + 64,
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

  const items = virtualizer.getVirtualItems()
  // The page under the top third of the viewport.
  const probe = (virtualizer.scrollOffset ?? 0) + (virtualizer.scrollRect?.height ?? 0) / 3
  const current = (items.find((item) => item.end > probe) ?? items.at(-1))?.index ?? 0

  const show = (page: number) => {
    if (pageCount === 0) return
    virtualizer.scrollToIndex(Math.min(Math.max(page, 1), pageCount) - 1, { align: 'start' })
  }

  // A new width, zoom or page shape changes every estimate; a zoom stays on the same page.
  useEffect(() => {
    virtualizer.measure()
    if (keep.current !== null) {
      virtualizer.scrollToIndex(keep.current, { align: 'start' })
      keep.current = null
    }
  }, [virtualizer, pageHeight])

  // Go to the requested page (the one the preview opened on, a contents entry, a search hit)
  // once the pages are laid out.
  useEffect(() => {
    if (!target || pageCount === 0) return
    const index = Math.min(Math.max(target.page, 1), pageCount) - 1
    virtualizer.scrollToIndex(index, { align: 'start' })
  }, [virtualizer, pageCount, target])

  useEffect(() => {
    if (pageCount > 0) onPageChange?.(current + 1)
  }, [onPageChange, pageCount, current])

  return (
    <>
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
        <Document
          file={url}
          options={OPTIONS}
          externalLinkTarget="_blank"
          externalLinkRel="noopener noreferrer"
          suspense={false}
          onLoadSuccess={(pdf) => {
            // Estimate every page from the first one's shape before laying them out, so opening
            // on a later page lands there; rendered pages are measured.
            const laidOut = (shape = DEFAULT_RATIO) => {
              setRatio(shape)
              setPageCount(pdf.numPages)
            }
            pdf.getPage(1).then(
              (first) => {
                const { width: w, height: h } = first.getViewport({ scale: 1 })
                laidOut(w > 0 && h > 0 ? h / w : undefined)
              },
              () => laidOut(),
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
          <div
            className="relative"
            style={{
              height: virtualizer.getTotalSize(),
              // Zoomed past the window, the pages scroll sideways too.
              width: Math.max(pageWidth + 2 * PADDING, width ?? 0),
            }}
          >
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
      {pageCount > 0 ? (
        <PageControls
          page={current + 1}
          total={pageCount}
          onPage={show}
          zoom={zoom}
          onZoom={(next) => {
            keep.current = current
            setZoom(next)
          }}
        />
      ) : null}
    </>
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
