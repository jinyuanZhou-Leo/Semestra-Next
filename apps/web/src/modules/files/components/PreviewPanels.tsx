import type { OutlineEntry, SearchHit } from '@semestra/api-client'
import { SearchX } from 'lucide-react'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/ui/item'
import { Skeleton } from '@/ui/skeleton'
import { pageRangeLabel } from './Citation'
import { Snippet } from './SearchResults'

/** The entry the reader is in: the last one starting on or before the current page. */
export function currentEntry(entries: readonly OutlineEntry[], page: number): number {
  let found = -1
  entries.forEach((entry, index) => {
    if (entry.page <= page) found = index
  })
  return found
}

/** The file's headings (M07 `files.document.outline`), indented by level; a click goes there. */
export function PreviewOutline({
  entries,
  page,
  onOpen,
}: {
  entries: readonly OutlineEntry[]
  page: number
  onOpen: (page: number) => void
}) {
  const top = Math.min(...entries.map((entry) => entry.level))
  const active = currentEntry(entries, page)
  return (
    <>
      <h2 className="px-5 pt-4 pb-2 text-xs font-medium text-muted-foreground">
        {m.files_preview_contents()}
      </h2>
      <nav
        aria-label={m.files_preview_contents()}
        className="min-h-0 flex-1 overflow-auto px-3 pb-4"
      >
        {entries.map((entry, index) => (
          <button
            // Headings can repeat; their order never changes.
            // oxlint-disable-next-line react/no-array-index-key
            key={index}
            type="button"
            aria-current={index === active ? 'location' : undefined}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg py-1.5 pr-2 text-left text-sm transition-colors hover:bg-muted',
              index === active ? 'bg-muted font-medium' : 'text-foreground/85',
            )}
            style={{ paddingLeft: 8 + Math.min(entry.level - top, 3) * 14 }}
            onClick={() => onOpen(entry.page)}
          >
            <span className="min-w-0 flex-1 truncate">{entry.title}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{entry.page}</span>
          </button>
        ))}
      </nav>
    </>
  )
}

/** Passages of the open file that match the search box; a click goes to the page. */
export function PreviewSearchHits({
  hits,
  loading,
  selected,
  onOpen,
}: {
  hits: readonly SearchHit[]
  loading: boolean
  selected: string | null
  onOpen: (hit: SearchHit) => void
}) {
  if (loading && hits.length === 0) {
    return (
      <div className="space-y-2 p-4">
        <Skeleton className="h-16 w-full rounded-2xl" />
        <Skeleton className="h-16 w-full rounded-2xl" />
      </div>
    )
  }
  if (hits.length === 0) {
    return (
      <Empty className="border-0 p-6">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchX aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{m.files_preview_search_none()}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <>
      <h2 className="px-5 pt-4 pb-2 text-xs font-medium text-muted-foreground">
        {m.files_preview_search_count({ count: hits.length })}
      </h2>
      <ItemGroup className="min-h-0 flex-1 gap-1 overflow-auto px-3 pb-4">
        {hits.map((hit) => (
          <Item
            key={hit.citation_id}
            size="sm"
            className={cn(hit.citation_id === selected && 'bg-muted')}
            render={(props) => <button type="button" {...props} onClick={() => onOpen(hit)} />}
          >
            <ItemContent className="min-w-0 text-left">
              <ItemTitle className="w-full">
                <span className="truncate">{hit.heading_path.at(-1) ?? hit.display_name}</span>
                <span className="ml-auto shrink-0 font-normal text-muted-foreground tabular-nums">
                  {pageRangeLabel(hit.page_from, hit.page_to)}
                </span>
              </ItemTitle>
              <ItemDescription className="line-clamp-2">
                <Snippet text={hit.snippet} />
              </ItemDescription>
            </ItemContent>
          </Item>
        ))}
      </ItemGroup>
    </>
  )
}
