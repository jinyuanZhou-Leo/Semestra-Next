import { filesItemMarkSeenMutation } from '@semestra/api-client/react-query'
import { useMutation } from '@tanstack/react-query'
import type { FolderOut, ItemOut } from '@semestra/api-client'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, Folder, FolderOpen, Search, SearchX } from 'lucide-react'
import { useState } from 'react'
import type { PageProps } from '@/app/extensions'
import { MobileList, MobileSection } from '@/app/mobile/MobilePage'
import { formatBytes, formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/ui/input-group'
import { Skeleton } from '@/ui/skeleton'
import { FileIcon } from '../components/FileIcon'
import { NewDot } from '../components/browser'
import { compareNames, freshFolders } from '../folders'
import { contentUrl, useCourseFiles } from '../queries'
import { matchNames } from '../search-names'

/**
 * A course's files on a phone (M17 §4.1), read only: its folders one level at a time
 * (`?folder=`), a search by name over the whole course, and each file opening in the browser's own
 * viewer. `?file=` (a notification's link) opens the file's folder with the file marked. Uploading,
 * moving and organizing stay on the desktop.
 */
export default function CourseFilesMobile({ scope }: PageProps) {
  const courseId = scope.kind === 'course' ? scope.courseId : ''
  const search = useSearch({ strict: false }) as { folder?: string; file?: string }
  const navigate = useNavigate()
  const data = useCourseFiles(courseId).data
  const [query, setQuery] = useState('')
  if (!data) {
    return (
      <MobileSection title={m.files_nav()}>
        <Skeleton className="h-48 rounded-2xl" />
      </MobileSection>
    )
  }
  const marked = data.items.find((i) => i.id === search.file)
  const folderId = search.folder ?? marked?.folder_id ?? null
  const folder = data.folders.find((f) => f.id === folderId) ?? null
  const parent = folder ? (data.folders.find((f) => f.id === folder.parent_id) ?? null) : null
  const go = (to: string | null) =>
    void navigate({
      to: '.',
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        folder: to ?? undefined,
        file: undefined,
      }),
    })
  const searching = query.trim() !== ''
  const found = searching ? matchNames(query, [data]) : null
  const folders = found
    ? found.folders.map((f) => f.entry)
    : data.folders
        .filter((f) => f.parent_id === (folder?.id ?? null))
        .toSorted((a, b) => compareNames(a.name, b.name))
  const items = found
    ? found.items.map((f) => f.entry)
    : data.items
        .filter((i) => i.folder_id === (folder?.id ?? null))
        .toSorted((a, b) => compareNames(a.display_name, b.display_name))
  const empty = data.folders.length === 0 && data.items.length === 0
  const fresh = freshFolders(data.folders, data.items)
  return (
    <>
      {empty ? null : (
        <div className="px-4 pt-4">
          <InputGroup className="h-10 rounded-full bg-muted/60">
            <InputGroupAddon>
              <Search aria-hidden />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              value={query}
              placeholder={m.mobile_files_search()}
              aria-label={m.mobile_files_search()}
              className="text-base"
              onChange={(event) => setQuery(event.target.value)}
            />
          </InputGroup>
        </div>
      )}
      {folder && !searching ? (
        <button
          type="button"
          className="mx-4 mt-3 flex h-8 items-center gap-0.5 text-sm font-medium text-primary"
          onClick={() => go(parent?.id ?? null)}
        >
          <ChevronLeft aria-hidden className="size-4" />
          {parent?.name ?? m.files_nav()}
        </button>
      ) : null}
      {folders.length === 0 && items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              {searching ? <SearchX aria-hidden /> : <FolderOpen aria-hidden />}
            </EmptyMedia>
            <EmptyTitle>
              {searching
                ? m.mobile_files_no_match()
                : folder
                  ? m.files_folder_empty_title()
                  : m.files_empty_title()}
            </EmptyTitle>
          </EmptyHeader>
          {searching ? (
            <EmptyContent>
              <Button variant="outline" size="sm" onClick={() => setQuery('')}>
                {m.files_search_clear()}
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <MobileSection
          title={searching ? m.mobile_files_results() : (folder?.name ?? m.files_nav())}
        >
          <MobileList label={folder?.name ?? m.files_nav()}>
            {folders.map((f) => (
              <FolderRow
                key={f.id}
                folder={f}
                fresh={fresh.has(f.id)}
                onOpen={() => {
                  setQuery('')
                  go(f.id)
                }}
              />
            ))}
            {items.map((item) => (
              <FileRow key={item.id} item={item} marked={item.id === marked?.id} />
            ))}
          </MobileList>
        </MobileSection>
      )}
    </>
  )
}

function FolderRow({
  folder,
  fresh,
  onOpen,
}: {
  folder: FolderOut
  fresh: boolean
  onOpen: () => void
}) {
  return (
    <li>
      <button
        type="button"
        className="flex min-h-13 w-full items-center gap-3 px-4 py-2.5 text-left"
        onClick={onOpen}
      >
        <Folder aria-hidden className="size-5 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="truncate font-medium">{folder.name}</span>
          {fresh ? <NewDot /> : null}
        </span>
        <span className="text-sm text-muted-foreground tabular-nums">{folder.item_count}</span>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  )
}

function FileRow({ item, marked }: { item: ItemOut; marked: boolean }) {
  // A link opens where it points; a file in the browser's own viewer (PDFs, images).
  const href = item.kind === 'link' ? item.url : contentUrl(item.id)
  // Opened, a new file is new no more, as when the desktop previews it.
  const { mutate: markSeen } = useMutation(filesItemMarkSeenMutation())
  return (
    <li className={cn(marked && 'bg-primary/8')}>
      <a
        href={href ?? undefined}
        target="_blank"
        rel="noreferrer"
        className="flex min-h-13 items-center gap-3 px-4 py-2.5"
        onClick={() => {
          if (item.unseen) markSeen({ path: { item_id: item.id } })
        }}
      >
        <FileIcon item={item} aria-hidden className="size-5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-medium">{item.display_name}</span>
            {item.unseen ? <NewDot /> : null}
          </span>
          <span className="block truncate text-xs text-muted-foreground tabular-nums">
            {[
              item.kind === 'file' ? formatBytes(item.size_bytes) : null,
              formatDate(item.modified_at, { short: true }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
      </a>
    </li>
  )
}
