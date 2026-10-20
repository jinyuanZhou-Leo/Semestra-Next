import type { ItemOut, SearchHit } from '@semestra/api-client'
import { filesDocumentSearch } from '@semestra/api-client'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { SearchX } from 'lucide-react'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from '@/ui/item'
import { Skeleton } from '@/ui/skeleton'
import { snippetParts } from '../highlight'
import { pageRangeLabel } from './Citation'
import { FileIcon } from './FileIcon'

/** Content search over a Program's files (M07 §3.2); the scope narrows it. */
export function useContentSearch(
  programId: string,
  query: string,
  scope: { courseIds?: string[]; termId?: string },
) {
  const q = query.trim()
  return useQuery({
    // Shaped like a generated key so realtime events and invalidateFiles refresh it too.
    queryKey: [
      {
        _id: 'filesDocumentSearch',
        programId,
        q,
        courseIds: scope.courseIds,
        termId: scope.termId,
      },
    ],
    queryFn: async ({ signal }) => {
      const { data } = await filesDocumentSearch({
        path: { program_id: programId },
        body: {
          query: q,
          course_ids: scope.courseIds ?? null,
          term_id: scope.termId ?? null,
          top_k: 12,
          mode: 'hybrid',
        },
        signal,
        throwOnError: true,
      })
      return data
    },
    enabled: q.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
}

function Snippet({ text }: { text: string }) {
  return (
    <>
      {snippetParts(text).map((part, index) =>
        part.marked ? (
          // oxlint-disable-next-line no-array-index-key -- parts never reorder
          <mark key={index} className="rounded-sm bg-primary/15 px-0.5 text-foreground">
            {part.text}
          </mark>
        ) : (
          // oxlint-disable-next-line no-array-index-key -- parts never reorder
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  )
}

/**
 * Results of typing in the file page's search box: files whose name matches, then passages
 * whose text matches. `courseName` labels hits when several courses are searched.
 */
export function SearchResults({
  nameMatches,
  hits,
  loading,
  pendingNames,
  courseName,
  onOpenItem,
  onOpenHit,
  onClear,
}: {
  nameMatches: readonly ItemOut[]
  hits: readonly SearchHit[]
  loading: boolean
  pendingNames: readonly string[]
  courseName?: (courseId: string) => string
  onOpenItem: (item: ItemOut) => void
  onOpenHit: (hit: SearchHit) => void
  onClear: () => void
}) {
  if (!loading && nameMatches.length === 0 && hits.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchX aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{m.files_search_no_match()}</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={onClear}>
            {m.files_search_clear()}
          </Button>
        </EmptyContent>
      </Empty>
    )
  }
  return (
    <div className="space-y-6">
      {nameMatches.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">{m.files_search_names()}</h2>
          <ItemGroup className="rounded-2xl border">
            {nameMatches.map((item, index) => {
              return (
                <div key={item.id}>
                  {index > 0 ? <ItemSeparator /> : null}
                  <Item
                    size="sm"
                    render={(props) => (
                      <button type="button" {...props} onClick={() => onOpenItem(item)} />
                    )}
                  >
                    <ItemMedia variant="icon">
                      <FileIcon item={item} aria-hidden />
                    </ItemMedia>
                    <ItemContent className="min-w-0 text-left">
                      <ItemTitle className="w-full truncate">{item.display_name}</ItemTitle>
                      {courseName ? (
                        <ItemDescription>{courseName(item.course_id)}</ItemDescription>
                      ) : null}
                    </ItemContent>
                  </Item>
                </div>
              )
            })}
          </ItemGroup>
        </section>
      ) : null}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">{m.files_search_contents()}</h2>
        {pendingNames.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            {m.files_search_pending({ names: pendingNames.join(', ') })}
          </p>
        ) : null}
        {loading && hits.length === 0 ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full rounded-2xl" />
            <Skeleton className="h-16 w-full rounded-2xl" />
          </div>
        ) : hits.length === 0 ? (
          <p className="text-xs text-muted-foreground">{m.files_search_no_passages()}</p>
        ) : (
          <ItemGroup className="rounded-2xl border">
            {hits.map((hit, index) => (
              <div key={hit.citation_id}>
                {index > 0 ? <ItemSeparator /> : null}
                <Item
                  size="sm"
                  render={(props) => (
                    <button type="button" {...props} onClick={() => onOpenHit(hit)} />
                  )}
                >
                  <ItemContent className="min-w-0 text-left">
                    <ItemTitle className="w-full">
                      <span className="truncate">{hit.display_name}</span>
                      <span className="shrink-0 font-normal text-muted-foreground tabular-nums">
                        {pageRangeLabel(hit.page_from, hit.page_to)}
                      </span>
                    </ItemTitle>
                    <ItemDescription className="line-clamp-2">
                      {[courseName?.(hit.course_id), hit.heading_path.join(' › ')]
                        .filter(Boolean)
                        .join(' · ')}
                      {courseName || hit.heading_path.length ? ' — ' : ''}
                      <Snippet text={hit.snippet} />
                    </ItemDescription>
                  </ItemContent>
                </Item>
              </div>
            ))}
          </ItemGroup>
        )}
      </section>
    </div>
  )
}
