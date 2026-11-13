import 'react-pdf/dist/Page/TextLayer.css'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import { observeElementRect, useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import { m } from '@/paraglide/messages'
import { Alert, AlertDescription } from '@/ui/alert'
import { Spinner } from '@/ui/spinner'
import { highlightHtml } from '../highlight'
import type { PageTarget } from '../page-target'
import { clampZoom, PageControls } from './PageControls'

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
// Room for the floating page bar under the last page.
const PADDING_END = PADDING + 64
// A4 portrait until the pages say otherwise.
const DEFAULT_RATIO = 297 / 210
// Stable, so a page's text renderer keeps its identity across scroll renders.
const NO_TERMS: readonly string[] = []

/**
 * The whole document as one vertical scroll, fitted to the width and zoomable, with search terms
 * highlighted (M07 §6.1). Only the pages near the viewport are rendered; every page's size comes
 * from its shape (height / width: the first page's at once, each page's own once read in the
 * background), so the layout is known before pdf.js draws anything and a new width or shape
 * keeps the reader where they were. The page bar floats at
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
  // Each page's height / width.
  const [shapes, setShapes] = useState<readonly number[]>([])
  const pageCount = shapes.length
  const [width, setWidth] = useState<number>()
  const [zoom, setZoom] = useState(1)
  const scroller = useRef<HTMLDivElement>(null)
  // The page at the top of the view and how far into it, as of the last scroll.
  const anchor = useRef<{ index: number; fraction: number } | null>(null)
  const fit = Math.min(Math.max((width ?? 0) - 2 * PADDING, 240), MAX_WIDTH)
  const pageWidth = Math.round(fit * zoom)
  const heightOf = (index: number) => Math.round(pageWidth * (shapes[index] ?? DEFAULT_RATIO))
  // Where each page starts in the scroll.
  const starts: number[] = []
  let totalSize = PADDING
  for (let index = 0; index < pageCount; index++) {
    starts.push(totalSize)
    totalSize += heightOf(index) + GAP
  }
  totalSize += PADDING_END

  // Ctrl/⌘ + the wheel (a trackpad pinch arrives the same way) zooms instead of scrolling. The
  // listener is not passive so the browser's own page zoom can be prevented.
  useEffect(() => {
    const element = scroller.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      setZoom((z) => clampZoom(z * Math.exp(-event.deltaY * 0.01)))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  // The React Compiler leaves this component uncompiled: the virtualizer is one mutable object
  // that re-renders it on scroll, and cached reads from it would go stale.
  // oxlint-disable-next-line react/incompatible-library -- see above
  const virtualizer = useVirtualizer({
    count: pageCount,
    getScrollElement: () => scroller.current,
    estimateSize: (index) => heightOf(index) + GAP,
    overscan: 2,
    paddingStart: PADDING,
    paddingEnd: PADDING_END,
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

  // A new width (zoom, a panel opening beside the file) or the pages' shapes resize every page;
  // the reader stays on the same spot of the same page. Before paint, so nothing jumps.
  useLayoutEffect(() => {
    virtualizer.measure()
    const at = anchor.current
    const element = scroller.current
    if (!at || !element || at.index >= pageCount) return
    element.scrollTop = (starts[at.index] ?? 0) + at.fraction * (heightOf(at.index) + GAP)
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `starts` and `heightOf` follow these
  }, [virtualizer, pageWidth, shapes])

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
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-auto"
        onScroll={(event) => {
          const top = event.currentTarget.scrollTop
          const index = Math.max(
            starts.findLastIndex((start) => start <= top),
            0,
          )
          const size = heightOf(index) + GAP
          anchor.current =
            pageCount > 0
              ? { index, fraction: Math.min(Math.max((top - (starts[index] ?? 0)) / size, 0), 1) }
              : null
        }}
      >
        <Document
          file={url}
          options={OPTIONS}
          externalLinkTarget="_blank"
          externalLinkRel="noopener noreferrer"
          suspense={false}
          onLoadSuccess={(pdf) => {
            // Lay every page out in the first page's shape at once, so the document shows (and
            // opens on a later page) without reading the rest; their own shapes follow in the
            // background, and the reader keeps their place when they arrive. A page that can't be
            // read keeps the first page's shape (and shows its error).
            const shapeOf = (n: number, fallback: number) =>
              pdf.getPage(n).then(
                (page) => {
                  const { width: w, height: h } = page.getViewport({ scale: 1 })
                  return w > 0 && h > 0 ? h / w : fallback
                },
                () => fallback,
              )
            void shapeOf(1, DEFAULT_RATIO).then((first) => {
              setShapes(Array.from({ length: pdf.numPages }, () => first))
              if (pdf.numPages === 1) return
              void Promise.all(
                Array.from({ length: pdf.numPages }, (_, n) => shapeOf(n + 1, first)),
              ).then((all) => {
                if (all.some((shape) => shape !== first)) setShapes(all)
              })
            })
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
              height: totalSize,
              // Zoomed past the window, the pages scroll sideways too.
              width: Math.max(pageWidth + 2 * PADDING, width ?? 0),
            }}
          >
            {items.map((item) => (
              <div
                key={item.key}
                data-index={item.index}
                className="absolute top-0 left-0 flex w-full justify-center"
                style={{
                  transform: `translateY(${item.start}px)`,
                  height: item.size,
                  paddingBottom: GAP,
                }}
              >
                <PdfPage
                  pageNumber={item.index + 1}
                  width={pageWidth}
                  height={heightOf(item.index)}
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
          onZoom={setZoom}
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
