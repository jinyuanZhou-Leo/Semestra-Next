import type { ItemOut } from '@semestra/api-client'
import { filesContentOptions, filesDocumentReadOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { Download, FileX, SquareArrowOutUpRight } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/ui/empty'
import { Spinner } from '@/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { previewKind } from '../kinds'
import { contentUrl, useFileItem } from '../queries'
import { Markdown } from './Markdown'
import { FileIcon } from './FileIcon'

// pdf.js is large; load it only when a PDF is opened.
const PdfViewer = lazy(() => import('./PdfViewer').then((mod) => ({ default: mod.PdfViewer })))

/** What to show: a file, optionally a page in it and words to highlight (a search hit). */
export type PreviewTarget = { itemId: string; page?: number; terms?: readonly string[] }

const READ_WINDOW = 30

function TextPreview({ item, markdown }: { item: ItemOut; markdown: boolean }) {
  const query = useQuery({
    ...filesContentOptions({
      path: { item_id: item.id },
      query: { disposition: 'inline' },
      parseAs: 'text',
    }),
    staleTime: Infinity,
  })
  return (
    <AsyncBoundary query={query}>
      {(text) =>
        markdown ? (
          <Markdown>{String(text)}</Markdown>
        ) : (
          <pre className="text-sm whitespace-pre-wrap break-words">{String(text)}</pre>
        )
      }
    </AsyncBoundary>
  )
}

/** Word, PowerPoint, Excel and HTML files: the text the pipeline extracted, page by page. */
function DocumentPreview({ item, page = 1 }: { item: ItemOut; page?: number }) {
  const [from, setFrom] = useState(Math.max(1, page - 2))
  const query = useQuery({
    ...filesDocumentReadOptions({
      path: { item_id: item.id },
      query: { page_from: from, page_to: from + READ_WINDOW - 1 },
    }),
    staleTime: Infinity,
  })
  // Bring the requested page into view once it has rendered.
  useEffect(() => {
    if (query.data) document.getElementById(`files-page-${item.id}-${page}`)?.scrollIntoView()
  }, [query.data, item.id, page])

  return (
    <AsyncBoundary query={query}>
      {(doc) => (
        <div className="space-y-6">
          {from > 1 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFrom(Math.max(1, from - READ_WINDOW))}
            >
              {m.files_preview_earlier_pages()}
            </Button>
          ) : null}
          {doc.pages.map((p) => (
            <section
              key={p.page_no}
              id={`files-page-${item.id}-${p.page_no}`}
              className="space-y-2"
            >
              <p className="text-xs text-muted-foreground">
                {m.files_preview_page_label({ page: p.page_no })}
              </p>
              <Markdown>{p.markdown}</Markdown>
            </section>
          ))}
          {doc.next_page ? (
            <Button variant="outline" size="sm" onClick={() => setFrom(doc.next_page ?? from)}>
              {m.files_preview_later_pages()}
            </Button>
          ) : null}
        </div>
      )}
    </AsyncBoundary>
  )
}

function NoPreview({ item }: { item: ItemOut }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          {item.doc_status === 'unsupported' ? (
            <FileX aria-hidden />
          ) : (
            <FileIcon item={item} aria-hidden />
          )}
        </EmptyMedia>
        <EmptyTitle>{m.files_preview_unavailable()}</EmptyTitle>
        <EmptyDescription>{m.files_preview_unavailable_description()}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          // oxlint-disable-next-line jsx-a11y/anchor-has-content -- the content arrives through `props`
          render={(props) => <a {...props} href={contentUrl(item.id, 'attachment')} download />}
        >
          {m.files_download()}
        </Button>
      </EmptyContent>
    </Empty>
  )
}

function PreviewBody({ item, target }: { item: ItemOut; target: PreviewTarget }) {
  const kind = previewKind(item)
  if (kind === 'pdf') {
    return (
      <Suspense
        fallback={
          <div className="flex h-64 items-center justify-center">
            <Spinner />
          </div>
        }
      >
        <PdfViewer url={contentUrl(item.id)} initialPage={target.page} terms={target.terms} />
      </Suspense>
    )
  }
  if (kind === 'image') {
    return (
      <div className="flex justify-center">
        <img src={contentUrl(item.id)} alt={item.display_name} className="max-h-full max-w-full" />
      </div>
    )
  }
  if (kind === 'text' || kind === 'markdown') {
    return <TextPreview item={item} markdown={kind === 'markdown'} />
  }
  if (kind === 'document') return <DocumentPreview item={item} page={target.page} />
  return <NoPreview item={item} />
}

/** Preview of a file (M07 §6.1); `target` null closes it. */
export function PreviewDialog({
  target,
  onClose,
}: {
  target: PreviewTarget | null
  onClose: () => void
}) {
  const item = useFileItem(target?.itemId)
  const data = item.data
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[85vh] flex-col gap-3 sm:max-w-5xl">
        <DialogHeader className="flex-row items-center gap-2 pr-8">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate">
              {data?.display_name ?? m.common_loading()}
            </DialogTitle>
            <DialogDescription className="sr-only">{m.files_preview_title()}</DialogDescription>
          </div>
          {data && data.kind === 'file' ? (
            <>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={m.files_open_new_tab()}
                      render={(props) => (
                        // oxlint-disable-next-line jsx-a11y/anchor-has-content -- content via `props`
                        <a
                          {...props}
                          href={contentUrl(data.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                        />
                      )}
                    />
                  }
                >
                  <SquareArrowOutUpRight aria-hidden />
                </TooltipTrigger>
                <TooltipContent>{m.files_open_new_tab()}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={m.files_download()}
                      render={(props) => (
                        // oxlint-disable-next-line jsx-a11y/anchor-has-content -- content via `props`
                        <a {...props} href={contentUrl(data.id, 'attachment')} download />
                      )}
                    />
                  }
                >
                  <Download aria-hidden />
                </TooltipTrigger>
                <TooltipContent>{m.files_download()}</TooltipContent>
              </Tooltip>
            </>
          ) : null}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto">
          {target ? (
            <AsyncBoundary query={item}>
              {(loaded) => (
                <PreviewBody
                  key={`${loaded.id}:${target.page ?? 1}`}
                  item={loaded}
                  target={target}
                />
              )}
            </AsyncBoundary>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
