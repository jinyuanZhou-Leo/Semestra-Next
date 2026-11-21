import type { FolderOut, ItemOut, SearchHit } from '@semestra/api-client'
import { filesDocumentSearch } from '@semestra/api-client'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Folder, SearchX } from 'lucide-react'
import { formatTimeAgo } from '@/lib/format'
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
import type { NameMatch } from '../search-names'
import { pageRangeLabel } from './Citation'
import { FileIcon } from './FileIcon'

/** Content search over a Program's files (M07 §3.2); the scope narrows it (to one file in the preview). */
export function useContentSearch(
  programId: string,
  query: string,
  scope: { courseIds?: string[]; termId?: string; itemIds?: string[] },
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
        itemIds: scope.itemIds,
      },
    ],
    queryFn: async ({ signal }) => {
      const { data } = await filesDocumentSearch({
        path: { program_id: programId },
        body: {
          query: q,
          course_ids: scope.courseIds ?? null,
          term_id: scope.termId ?? null,
          item_ids: scope.itemIds ?? null,
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
  })
}

export function Snippet({ text }: { text: string }) {
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

/** `text` with every case-insensitive occurrence of `needle` marked, as in content snippets. */
function Marked({ text, needle }: { text: string; needle: string }) {
  const wanted = needle.trim().toLowerCase()
  const parts: { text: string; marked: boolean }[] = []
  let from = 0
  const lower = text.toLowerCase()
  for (;;) {
    if (!wanted) break
    const at = lower.indexOf(wanted, from)
    if (at < 0) break
    if (at > from) parts.push({ text: text.slice(from, at), marked: false })
    parts.push({ text: text.slice(at, at + wanted.length), marked: true })
    from = at + wanted.length
  }
  if (from < text.length) parts.push({ text: text.slice(from), marked: false })
  return (
    <>
      {parts.map((part, index) =>
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

function Heading({ children, count }: { children: string; count: number }) {
  return (
    <h2 className="flex gap-1.5 text-xs font-medium text-muted-foreground">
      {children}
      <span className="tabular-nums">{count}</span>
    </h2>
  )
}

/** "Course · All files › Folder": where a match is. */
function where(match: NameMatch<unknown>, courseName?: (courseId: string) => string) {
  const place = match.trail.length > 0 ? match.trail.join(' › ') : m.files_all_files()
  return [courseName?.(match.courseId), place].filter(Boolean).join(' · ')
}

/**
 * Results of typing in the file page's search box: folders and files whose name matches, then
 * passages whose text matches. `courseName` labels matches when several courses are searched.
 */
export function SearchResults({
  needle,
  folderMatches,
  nameMatches,
  hits,
  loading,
  pendingNames,
  courseName,
  onOpenFolder,
  onOpenItem,
  onOpenHit,
  onClear,
}: {
  needle: string
  folderMatches: readonly NameMatch<FolderOut>[]
  nameMatches: readonly NameMatch<ItemOut>[]
  hits: readonly SearchHit[]
  loading: boolean
  pendingNames: readonly string[]
  courseName?: (courseId: string) => string
  onOpenFolder: (folder: FolderOut) => void
  onOpenItem: (item: ItemOut) => void
  onOpenHit: (hit: SearchHit) => void
  onClear: () => void
}) {
  if (!loading && folderMatches.length === 0 && nameMatches.length === 0 && hits.length === 0) {
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
    <div className="space-y-5">
      {folderMatches.length > 0 ? (
        <section className="space-y-2">
          <Heading count={folderMatches.length}>{m.files_search_folders()}</Heading>
          <ItemGroup className="rounded-2xl border">
            {folderMatches.map((match, index) => (
              <div key={match.entry.id}>
                {index > 0 ? <ItemSeparator /> : null}
                <Item
                  size="sm"
                  render={(props) => (
                    <button type="button" {...props} onClick={() => onOpenFolder(match.entry)} />
                  )}
                >
                  <ItemMedia variant="icon">
                    <Folder aria-hidden />
                  </ItemMedia>
                  <ItemContent className="min-w-0 text-left">
                    <ItemTitle className="w-full truncate">
                      <Marked text={match.entry.name} needle={needle} />
                    </ItemTitle>
                    <ItemDescription className="truncate">
                      {where(match, courseName)}
                    </ItemDescription>
                  </ItemContent>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {m.files_items_count({ count: match.entry.item_count })}
                  </span>
                </Item>
              </div>
            ))}
          </ItemGroup>
        </section>
      ) : null}
      {nameMatches.length > 0 ? (
        <section className="space-y-2">
          <Heading count={nameMatches.length}>{m.files_search_names()}</Heading>
          <ItemGroup className="rounded-2xl border">
            {nameMatches.map((match, index) => (
              <div key={match.entry.id}>
                {index > 0 ? <ItemSeparator /> : null}
                <Item
                  size="sm"
                  render={(props) => (
                    <button type="button" {...props} onClick={() => onOpenItem(match.entry)} />
                  )}
                >
                  <ItemMedia variant="icon">
                    <FileIcon item={match.entry} aria-hidden />
                  </ItemMedia>
                  <ItemContent className="min-w-0 text-left">
                    <ItemTitle className="w-full truncate">
                      <Marked text={match.entry.display_name} needle={needle} />
                    </ItemTitle>
                    <ItemDescription className="truncate">
                      {where(match, courseName)}
                    </ItemDescription>
                  </ItemContent>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatTimeAgo(match.entry.updated_at)}
                  </span>
                </Item>
              </div>
            ))}
          </ItemGroup>
        </section>
      ) : null}
      <section className="space-y-2">
        <Heading count={hits.length}>{m.files_search_contents()}</Heading>
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
