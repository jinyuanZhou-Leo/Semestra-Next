import 'react-pdf/dist/Page/TextLayer.css'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import { m } from '@/paraglide/messages'
import { Alert, AlertDescription } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Spinner } from '@/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { highlightHtml } from '../highlight'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

// Copied next to the app by vite.config.ts; CJK PDFs need the character maps.
const OPTIONS = {
  cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`,
  standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`,
  withCredentials: true,
}

/** One page at a time, fitted to the width, with search terms highlighted (M07 §6.1). */
export function PdfViewer({
  url,
  initialPage = 1,
  terms = [],
}: {
  url: string
  initialPage?: number
  terms?: readonly string[]
}) {
  const [pageCount, setPageCount] = useState<number | null>(null)
  const [page, setPage] = useState(initialPage)
  const [draft, setDraft] = useState(String(initialPage))
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [width, setWidth] = useState<number>()

  useEffect(() => {
    if (!container) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.floor(entry.contentRect.width))
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [container])

  const go = (next: number) => {
    const clamped = Math.min(Math.max(1, next), pageCount ?? next)
    setPage(clamped)
    setDraft(String(clamped))
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex h-8 shrink-0 items-center justify-center gap-1 text-sm">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={m.files_preview_previous_page()}
                disabled={page <= 1}
                onClick={() => go(page - 1)}
              />
            }
          >
            <ChevronLeft aria-hidden />
          </TooltipTrigger>
          <TooltipContent>{m.files_preview_previous_page()}</TooltipContent>
        </Tooltip>
        <form
          className="flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            const n = Number(draft)
            if (Number.isInteger(n)) go(n)
          }}
        >
          <Input
            aria-label={m.files_preview_page()}
            inputMode="numeric"
            className="h-7 w-12 text-center tabular-nums"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => setDraft(String(page))}
          />
          <span className="text-muted-foreground tabular-nums">
            {m.files_preview_page_of({ total: pageCount ?? '…' })}
          </span>
        </form>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={m.files_preview_next_page()}
                disabled={pageCount === null || page >= pageCount}
                onClick={() => go(page + 1)}
              />
            }
          >
            <ChevronRight aria-hidden />
          </TooltipTrigger>
          <TooltipContent>{m.files_preview_next_page()}</TooltipContent>
        </Tooltip>
      </div>
      <div ref={setContainer} className="min-h-0 flex-1 overflow-auto rounded-lg bg-muted/50">
        <Document
          file={url}
          options={OPTIONS}
          suspense={false}
          onLoadSuccess={({ numPages }) => {
            setPageCount(numPages)
            if (page > numPages) go(numPages)
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
          className="flex justify-center p-4"
        >
          <Page
            pageNumber={page}
            width={width ? Math.min(width - 32, 960) : undefined}
            customTextRenderer={({ str }) => highlightHtml(str, terms)}
            className="shadow-sm"
          />
        </Document>
      </div>
    </div>
  )
}
