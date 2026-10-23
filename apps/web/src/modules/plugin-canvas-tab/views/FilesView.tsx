import type { FileMeta, Folder as FolderOut } from '@semestra/api-client'
import { lmsFileSearchOptions, lmsFolderGetOptions } from '@semestra/api-client/react-query'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { File, Folder, FolderOpen, Lock, Search } from 'lucide-react'
import { Fragment, useState } from 'react'
import { formatBytes, formatDateTime } from '@/lib/format'
import { useDebounced } from '@/modules/files/hooks'
import { m } from '@/paraglide/messages'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/ui/breadcrumb'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/ui/input-group'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/ui/item'
import { CanvasBoundary } from '../CanvasBoundary'
import { useCanvasPage } from '../context'
import { FileActions } from './FilePreview'

/** Canvas needs two characters to search (`search_term`). */
const MIN_TERM = 2

/**
 * The course's Files tab (M16 §4): folders as Canvas has them (`selected` is the open folder,
 * the root when left out) and a search over every file of the course.
 */
export function FilesView({ selected }: { selected?: string }) {
  const [term, setTerm] = useState('')
  // Each search is a request to Canvas: wait until the user stops typing.
  const deferred = useDebounced(term.trim(), 300)
  const searching = deferred.length >= MIN_TERM
  return (
    <div className="space-y-4">
      <InputGroup className="sm:max-w-sm">
        <InputGroupAddon>
          <Search aria-hidden />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          value={term}
          maxLength={100}
          placeholder={m.canvas_tab_files_search()}
          aria-label={m.canvas_tab_files_search()}
          onChange={(event) => setTerm(event.target.value)}
        />
      </InputGroup>
      {searching ? <SearchResults term={deferred} /> : <FolderView folderId={selected} />}
    </div>
  )
}

function FolderView({ folderId }: { folderId?: string }) {
  const { courseId, go } = useCanvasPage()
  const listing = useQuery({
    ...lmsFolderGetOptions({
      path: { course_id: courseId },
      query: { folder_id: folderId },
    }),
    placeholderData: keepPreviousData,
  })
  return (
    <CanvasBoundary query={listing}>
      {(data) => (
        <div className="space-y-3">
          <Trail trail={data.trail.length > 0 ? data.trail : [data.folder]} />
          {data.folders.length === 0 && data.files.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FolderOpen aria-hidden />
                </EmptyMedia>
                <EmptyTitle>{m.canvas_tab_folder_empty()}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <ItemGroup className="gap-1">
              {data.folders.map((f) => (
                <FolderRow
                  key={f.external_id}
                  folder={f}
                  onOpen={() => go({ tab: 'files', ref: f.external_id })}
                />
              ))}
              {data.files.map((f) => (
                <FileRow key={f.external_id} file={f} />
              ))}
            </ItemGroup>
          )}
          {data.truncated ? (
            <p className="text-xs text-muted-foreground">{m.canvas_tab_files_truncated()}</p>
          ) : null}
        </div>
      )}
    </CanvasBoundary>
  )
}

/** Where the folder is, from the course's root; every step above it opens. */
function Trail({ trail }: { trail: FolderOut[] }) {
  const { go } = useCanvasPage()
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {trail.map((f, i) => {
          const name = f.path ? f.name : m.canvas_tab_files_root()
          const last = i === trail.length - 1
          return (
            <Fragment key={f.external_id}>
              {i > 0 ? <BreadcrumbSeparator /> : null}
              <BreadcrumbItem>
                {last ? (
                  <BreadcrumbPage>{name}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    render={
                      // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the children label it
                      <button
                        type="button"
                        onClick={() =>
                          go(f.path ? { tab: 'files', ref: f.external_id } : { tab: 'files' })
                        }
                      />
                    }
                  >
                    {name}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

function FolderRow({ folder: f, onOpen }: { folder: FolderOut; onOpen: () => void }) {
  return (
    <Item
      size="sm"
      render={
        // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the Item's children label it
        <button type="button" className="w-full text-left hover:bg-muted/50" onClick={onOpen} />
      }
    >
      <Folder aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <ItemContent>
        <ItemTitle className="line-clamp-1">{f.name}</ItemTitle>
        <ItemDescription>
          {m.canvas_tab_folder_counts({
            files: f.files_count ?? 0,
            folders: f.folders_count ?? 0,
          })}
        </ItemDescription>
      </ItemContent>
      {f.locked ? (
        <ItemActions>
          <Lock
            aria-label={m.canvas_tab_item_locked()}
            className="size-3.5 text-muted-foreground"
          />
        </ItemActions>
      ) : null}
    </Item>
  )
}

function FileRow({ file: f }: { file: FileMeta }) {
  const meta = [
    f.size_bytes == null ? null : formatBytes(f.size_bytes),
    f.updated_at ? m.canvas_tab_updated_at({ time: formatDateTime(f.updated_at) }) : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <Item size="sm">
      <File aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <ItemContent>
        <ItemTitle className="line-clamp-1">{f.name}</ItemTitle>
        {meta ? <ItemDescription>{meta}</ItemDescription> : null}
      </ItemContent>
      <ItemActions>
        {f.locked ? (
          <Lock
            aria-label={m.canvas_tab_item_locked()}
            className="size-3.5 text-muted-foreground"
          />
        ) : (
          <FileActions fileId={f.external_id} name={f.name} />
        )}
      </ItemActions>
    </Item>
  )
}

function SearchResults({ term }: { term: string }) {
  const { courseId } = useCanvasPage()
  const results = useQuery({
    ...lmsFileSearchOptions({ path: { course_id: courseId }, query: { term } }),
    placeholderData: keepPreviousData,
  })
  return (
    <CanvasBoundary
      query={results}
      isEmpty={(data) => data.items.length === 0}
      empty={
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Search aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{m.canvas_tab_files_no_match()}</EmptyTitle>
            <EmptyDescription>{m.canvas_tab_files_no_match_hint()}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      }
    >
      {(data) => (
        <div className="space-y-2">
          <ItemGroup className="gap-1">
            {data.items.map((f) => (
              <FileRow key={f.external_id} file={f} />
            ))}
          </ItemGroup>
          {data.truncated ? (
            <p className="text-xs text-muted-foreground">{m.canvas_tab_files_truncated()}</p>
          ) : null}
        </div>
      )}
    </CanvasBoundary>
  )
}
