import type { ItemOut, SearchHit } from '@semestra/api-client'
import {
  filesContentOptions,
  filesDocumentOutlineOptions,
  filesItemMarkSeenMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import {
  AppWindow,
  CloudOff,
  Download,
  FileX,
  RotateCw,
  Search,
  SquareArrowOutUpRight,
  X,
} from 'lucide-react'
import { Suspense, useEffect, useRef, useState } from 'react'
import { formatHotkey, useHotkey } from '@/app/hotkeys'
import { useUiPref } from '@/app/ui-pref'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { useDebounced } from '@/hooks/use-debounced'
import { formatBytes } from '@/lib/format'
import { SEGMENT, SEGMENTED } from '@/lib/segmented'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/ui/alert'
import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/ui/input-group'
import { Kbd } from '@/ui/kbd'
import { Spinner } from '@/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { searchTerms } from '../highlight'
import { fileKindName, opensInBrowser, previewKind } from '../kinds'
import { type PageTarget, pageTarget } from '../page-target'
import { contentUrl, useFileItem } from '../queries'
import type { FileItemAction } from '../types'
import { DocumentText } from './DocumentText'
import { FileIcon } from './FileIcon'
import { ItemActionButton, useItemActions } from './ItemActions'
import { LazyPdfViewer } from './LazyPdfViewer'
import { Markdown } from './Markdown'
import { PreviewOutline, PreviewSearchHits } from './PreviewPanels'
import { PreviewShell } from './PreviewShell'
import { useContentSearch } from './SearchResults'

// pdf.js is large; load it only when a PDF is opened.

/** What to show: a file, optionally a page in it and words to highlight (a search hit). */
export type PreviewTarget = { itemId: string; page?: number; terms?: readonly string[] }

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
    <div className="min-h-0 flex-1 overflow-auto bg-background px-8 py-6">
      <AsyncBoundary query={query}>
        {(text) =>
          markdown ? (
            <Markdown className="mx-auto max-w-3xl">{String(text)}</Markdown>
          ) : (
            <pre className="text-sm whitespace-pre-wrap break-words">{String(text)}</pre>
          )
        }
      </AsyncBoundary>
    </div>
  )
}

function NoPreview({ item, programId }: { item: ItemOut; programId?: string }) {
  // The original lives elsewhere (an LMS page): opening it there comes first.
  const [first] = useItemActions(item)
  return (
    <Empty className="bg-background">
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
      <EmptyContent className="flex-row justify-center">
        {first && programId ? (
          <ItemActionButton action={first} item={item} programId={programId} variant="default" />
        ) : null}
        <Button
          variant={first && programId ? 'outline' : 'default'}
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

type View = 'original' | 'text'

/** The file itself: what it is decides how it is shown (`previewKind`). */
function PreviewBody({
  item,
  programId,
  view,
  target,
  terms,
  onNavigate,
  onPageChange,
}: {
  item: ItemOut
  programId?: string
  view: View
  target: PageTarget
  terms: readonly string[]
  onNavigate: (page: number) => void
  onPageChange: (page: number) => void
}) {
  const kind = previewKind(item)
  // Which attempt at reading the original failed; "Try again" starts the next.
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(-1)
  const original = (kind === 'pdf' && view === 'original') || kind === 'image'
  if (original && failed === attempt && item.source_name && !item.stored) {
    // Read from its source, which can't be reached: what was read from it last time, if anything.
    return (
      <>
        <Alert className="m-4 mb-0 w-auto">
          <CloudOff aria-hidden />
          <AlertTitle>{m.files_preview_unreachable({ source: item.source_name })}</AlertTitle>
          {kind === 'pdf' ? (
            <AlertDescription>{m.files_preview_unreachable_description()}</AlertDescription>
          ) : null}
          <AlertAction>
            <Button size="sm" variant="outline" onClick={() => setAttempt(attempt + 1)}>
              <RotateCw aria-hidden />
              {m.common_retry()}
            </Button>
          </AlertAction>
        </Alert>
        {kind === 'pdf' ? (
          <DocumentText
            itemId={item.id}
            target={target}
            terms={terms}
            onNavigate={onNavigate}
            onPageChange={onPageChange}
          />
        ) : null}
      </>
    )
  }
  if ((kind === 'pdf' && view === 'text') || kind === 'document') {
    return (
      <DocumentText
        itemId={item.id}
        target={target}
        terms={terms}
        onNavigate={onNavigate}
        onPageChange={onPageChange}
      />
    )
  }
  if (kind === 'pdf') {
    return (
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center">
            <Spinner />
          </div>
        }
      >
        <LazyPdfViewer
          key={attempt}
          url={contentUrl(item.id)}
          onFail={() => setFailed(attempt)}
          target={target}
          terms={terms}
          onPageChange={onPageChange}
        />
      </Suspense>
    )
  }
  if (kind === 'image') {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
        <img
          key={attempt}
          src={contentUrl(item.id)}
          alt={item.display_name}
          onError={() => setFailed(attempt)}
          className="max-h-full max-w-full"
        />
      </div>
    )
  }
  if (kind === 'text' || kind === 'markdown') {
    return <TextPreview item={item} markdown={kind === 'markdown'} />
  }
  return <NoPreview item={item} programId={programId} />
}

/** Search box of the preview: ⌘F focuses it, Esc clears it before closing the preview. */
function SearchBox({
  value,
  onChange,
  enabled,
}: {
  value: string
  onChange: (value: string) => void
  enabled: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  useHotkey('mod+f', () => input.current?.focus(), { enabled, allowInInputs: true })
  return (
    <InputGroup className="w-72">
      <InputGroupAddon>
        <Search aria-hidden />
      </InputGroupAddon>
      <InputGroupInput
        ref={input}
        type="search"
        aria-label={m.files_preview_search()}
        placeholder={m.files_preview_search()}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value) {
            event.preventDefault()
            event.stopPropagation()
            onChange('')
          }
        }}
      />
      <InputGroupAddon align="inline-end">
        {value ? (
          <InputGroupButton
            size="icon-xs"
            aria-label={m.files_search_clear()}
            onClick={() => {
              onChange('')
              input.current?.focus()
            }}
          >
            <X aria-hidden />
          </InputGroupButton>
        ) : (
          <Kbd>{formatHotkey('mod+f')}</Kbd>
        )}
      </InputGroupAddon>
    </InputGroup>
  )
}

/**
 * Preview of a file (M07 §6.1); `target` null closes it. Processed PDFs and documents get their
 * contents on the left, a search box whose hits open on the right, and (PDFs) a switch between
 * the original and the text Semestra read from it.
 */
export function PreviewDialog({
  target,
  ...props
}: {
  target: PreviewTarget | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenChangeComplete?: (open: boolean) => void
}) {
  const { programId } = useParams({ strict: false }) as { programId?: string }
  const item = useFileItem(target?.itemId)
  const data = item.data
  // A file new from its source is new until opened.
  const { mutate: markSeen } = useMutation(filesItemMarkSeenMutation())
  const unseen = props.open && data?.unseen ? data.id : null
  useEffect(() => {
    if (unseen) markSeen({ path: { item_id: unseen } })
  }, [unseen, markSeen])
  const [contentsOpen, setContentsOpen] = useUiPref('files.preview_contents', true)

  // What the reader is doing in this file; a new target starts over.
  const [view, setView] = useState<View>('original')
  const [search, setSearch] = useState('')
  const [nav, setNav] = useState<PageTarget>(pageTarget(target?.page ?? 1))
  const [page, setPage] = useState(target?.page ?? 1)
  const [selected, setSelected] = useState<string | null>(null)
  const [shown, setShown] = useState(target)
  if (target !== shown) {
    setShown(target)
    if (target) {
      setView('original')
      setSearch('')
      setNav(pageTarget(target.page ?? 1))
      setPage(target.page ?? 1)
      setSelected(null)
    }
  }
  const query = useDebounced(search, 300).trim()

  const kind = data ? previewKind(data) : 'none'
  const actions = useItemActions(data)
  const readable = data?.doc_status === 'ready' && (kind === 'pdf' || kind === 'document')
  const outline = useQuery({
    ...filesDocumentOutlineOptions({ path: { item_id: data?.id ?? '' } }),
    enabled: readable,
    staleTime: Infinity,
  })
  const entries = readable ? (outline.data?.entries ?? []) : []
  const searchable = readable && Boolean(programId)
  const searching = searchable && query.length >= 2
  const hits = useContentSearch(programId ?? '', searching ? query : '', {
    itemIds: data ? [data.id] : [],
  })
  const terms = searching ? searchTerms(query) : (target?.terms ?? [])
  const go = (to: number) => setNav(pageTarget(to))
  const openHit = (hit: SearchHit) => {
    setSelected(hit.citation_id)
    go(hit.page_from)
  }

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
      actions={
        data && data.kind === 'file' ? (
          <>
            <OpenElsewhere
              item={data}
              actions={programId ? actions : []}
              programId={programId ?? ''}
              inBrowser={opensInBrowser(kind)}
            />
            <Button
              size="sm"
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
      tools={
        searchable ? (
          <>
            {kind === 'pdf' ? (
              <ToggleGroup
                aria-label={m.files_preview_view()}
                value={[view]}
                onValueChange={(next: string[]) => {
                  const picked = next[0]
                  if (picked === 'original' || picked === 'text') {
                    setView(picked)
                    go(page)
                  }
                }}
                className={cn(SEGMENTED, 'h-9 p-1')}
              >
                <ToggleGroupItem value="original" className={SEGMENT}>
                  {m.files_preview_view_original()}
                </ToggleGroupItem>
                <ToggleGroupItem value="text" className={SEGMENT}>
                  {m.files_preview_view_text()}
                </ToggleGroupItem>
              </ToggleGroup>
            ) : null}
            <SearchBox value={search} onChange={setSearch} enabled={props.open} />
          </>
        ) : null
      }
      sidebar={
        entries.length > 0 ? <PreviewOutline entries={entries} page={page} onOpen={go} /> : null
      }
      sidebarOpen={contentsOpen}
      onSidebarOpenChange={setContentsOpen}
      aside={
        searching ? (
          <PreviewSearchHits
            hits={hits.data?.results ?? []}
            loading={hits.isFetching}
            selected={selected}
            onOpen={openHit}
          />
        ) : null
      }
    >
      {target ? (
        <AsyncBoundary query={item}>
          {(loaded) => (
            <PreviewBody
              key={`${loaded.id}:${view}`}
              item={loaded}
              programId={programId}
              view={view}
              target={nav}
              terms={terms}
              onNavigate={go}
              onPageChange={setPage}
            />
          )}
        </AsyncBoundary>
      ) : null}
    </PreviewShell>
  )
}

/**
 * Where else the previewed file opens: a new tab (what the browser can show) and what other
 * modules add (`files.itemActions`, e.g. the file on its platform). Always one icon button in the
 * same place: one entry opens directly (named in its tooltip), more are its menu, so two
 * look-alike "open" icons never sit side by side.
 */
function OpenElsewhere({
  item,
  actions,
  programId,
  inBrowser,
}: {
  item: ItemOut
  actions: readonly FileItemAction[]
  programId: string
  inBrowser: boolean
}) {
  const [only] = actions
  if ((inBrowser ? 1 : 0) + actions.length > 1) {
    return <OpenMenu item={item} actions={actions} programId={programId} inBrowser={inBrowser} />
  }
  if (only) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => void only.run({ programId, item })}
            />
          }
        >
          <only.icon aria-hidden />
          <span className="sr-only">
            <only.Label programId={programId} item={item} />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <only.Label programId={programId} item={item} />
        </TooltipContent>
      </Tooltip>
    )
  }
  if (!inBrowser) return null
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            nativeButton={false}
            aria-label={m.files_open_new_tab()}
            render={
              // oxlint-disable-next-line jsx-a11y/control-has-associated-label, jsx-a11y/anchor-has-content -- labelled by aria-label
              <a href={contentUrl(item.id)} target="_blank" rel="noopener noreferrer" />
            }
          />
        }
      >
        <SquareArrowOutUpRight aria-hidden />
      </TooltipTrigger>
      <TooltipContent>{m.files_open_new_tab()}</TooltipContent>
    </Tooltip>
  )
}

function OpenMenu({
  item,
  actions,
  programId,
  inBrowser,
}: {
  item: ItemOut
  actions: readonly FileItemAction[]
  programId: string
  inBrowser: boolean
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-sm" aria-label={m.files_open_in()} />}
            />
          }
        >
          <SquareArrowOutUpRight aria-hidden />
        </TooltipTrigger>
        <TooltipContent>{m.files_open_in()}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        {inBrowser ? (
          <DropdownMenuItem
            render={(props) => (
              // oxlint-disable-next-line jsx-a11y/anchor-has-content -- the content arrives through `props`
              <a {...props} href={contentUrl(item.id)} target="_blank" rel="noopener noreferrer" />
            )}
          >
            <AppWindow aria-hidden />
            {m.files_open_new_tab()}
          </DropdownMenuItem>
        ) : null}
        {actions.map((action) => (
          <DropdownMenuItem key={action.id} onClick={() => void action.run({ programId, item })}>
            <action.icon aria-hidden />
            <action.Label programId={programId} item={item} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
