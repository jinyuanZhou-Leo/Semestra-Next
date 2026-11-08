import type { ItemOut } from '@semestra/api-client'
import { filesContentOptions, filesDocumentReadOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { Download, FileX, SquareArrowOutUpRight } from 'lucide-react'
import { Suspense, useEffect, useState } from 'react'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { formatBytes } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/ui/empty'
import { Spinner } from '@/ui/spinner'
import { fileKindName, previewKind } from '../kinds'
import { contentUrl, useFileItem } from '../queries'
import { LazyPdfViewer } from './LazyPdfViewer'
import { Markdown } from './Markdown'
import { FileIcon } from './FileIcon'
import { PreviewShell } from './PreviewShell'

// pdf.js is large; load it only when a PDF is opened.

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
          nativeButton={false}
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
        <LazyPdfViewer url={contentUrl(item.id)} initialPage={target.page} terms={target.terms} />
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
  ...props
}: {
  target: PreviewTarget | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenChangeComplete?: (open: boolean) => void
}) {
  const shown = target
  const item = useFileItem(shown?.itemId)
  const data = item.data
  return (
    <PreviewShell
      {...props}
      title={data?.display_name ?? m.common_loading()}
      meta={
        data && data.kind === 'file'
          ? [
              fileKindName({
                name: data.original_name ?? data.display_name,
                mime_type: data.mime_type,
              }),
              formatBytes(data.size_bytes),
            ]
              .filter(Boolean)
              .join(' · ')
          : null
      }
      footer={
        data && data.kind === 'file' ? (
          <>
            <Button
              variant="outline"
              nativeButton={false}
              // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the children label it
              render={<a href={contentUrl(data.id)} target="_blank" rel="noopener noreferrer" />}
            >
              <SquareArrowOutUpRight aria-hidden />
              {m.files_open_new_tab()}
            </Button>
            <Button
              nativeButton={false}
              // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the children label it
              render={<a href={contentUrl(data.id, 'attachment')} download />}
            >
              <Download aria-hidden />
              {m.files_download()}
            </Button>
          </>
        ) : null
      }
    >
      {shown ? (
        <AsyncBoundary query={item}>
          {(loaded) => (
            <PreviewBody key={`${loaded.id}:${shown.page ?? 1}`} item={loaded} target={shown} />
          )}
        </AsyncBoundary>
      ) : null}
    </PreviewShell>
  )
}
