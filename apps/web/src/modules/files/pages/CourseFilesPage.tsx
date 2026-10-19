import type { FilesList, ItemOut } from '@semestra/api-client'
import { FolderOpen, FolderPlus, LayoutGrid, Link2, List, Plus, Search, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import type { PageProps } from '@/app/extensions'
import { useUiPref } from '@/app/ui-pref'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { m } from '@/paraglide/messages'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/ui/breadcrumb'
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
import { Input } from '@/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { useExternalLink } from '../components/ExternalLink'
import { FileBrowser } from '../components/FileBrowser'
import { type ItemAction, ItemDialogs } from '../components/ItemDialogs'
import { PreviewDialog, type PreviewTarget } from '../components/PreviewDialog'
import { SearchResults, useContentSearch } from '../components/SearchResults'
import { useUploads } from '../components/Uploads'
import { UsageBar } from '../components/UsageBar'
import { searchTerms } from '../highlight'
import { useDebounced, useFileDrop } from '../hooks'
import { useCourseFiles } from '../queries'

type View = 'list' | 'grid'

/** The `files` page of a course (M07 §6.1). */
export default function CourseFilesPage({ scope }: PageProps) {
  const courseId = scope.kind === 'course' ? scope.courseId : ''
  return (
    <AsyncBoundary query={useCourseFiles(courseId)}>
      {(list) => (
        <CourseFiles key={courseId} list={list} courseId={courseId} programId={scope.programId} />
      )}
    </AsyncBoundary>
  )
}

function CourseFiles({
  list,
  courseId,
  programId,
}: {
  list: FilesList
  courseId: string
  programId: string
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [view, setView] = useUiPref<View>('files.view', 'list')
  const [folderId, setFolderId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [action, setAction] = useState<ItemAction | null>(null)
  const [preview, setPreview] = useState<PreviewTarget | null>(null)
  const link = useExternalLink()

  // The folder may have been deleted (here or in another tab).
  const folder = list.folders.find((f) => f.id === folderId) ?? null
  const currentId = folder?.id ?? null
  const uploads = useUploads({ courseId, folderId: currentId, existing: list.items })
  const dragging = useFileDrop(uploads.start)

  const query = useDebounced(search, 300)
  const searching = search.trim().length > 0
  const contentSearch = useContentSearch(programId, query, { courseIds: [courseId] })

  const trail: { id: string; name: string }[] = []
  let step = folder
  while (step) {
    trail.unshift({ id: step.id, name: step.name })
    const parentId = step.parent_id
    step = list.folders.find((p) => p.id === parentId) ?? null
  }
  const childFolders = list.folders.filter((f) => f.parent_id === currentId)
  const childItems = list.items.filter((i) => i.folder_id === currentId)
  const needle = search.trim().toLowerCase()
  const nameMatches = needle
    ? list.items.filter((i) => i.display_name.toLowerCase().includes(needle))
    : []

  const open = (item: ItemOut) => {
    if (item.kind === 'link' && item.url) link.open(item.url)
    else setPreview({ itemId: item.id })
  }
  const pickFiles = () => fileInput.current?.click()
  const empty = list.items.length === 0 && list.folders.length === 0

  return (
    <div className="space-y-3">
      <div className="flex min-h-9 flex-wrap items-center gap-2">
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label={m.files_search()}
            placeholder={m.files_search()}
            className="w-64 pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ToggleGroup
            aria-label={m.files_view()}
            variant="outline"
            value={[view]}
            onValueChange={(next) => {
              if (next[0]) setView(next[0] as View)
            }}
          >
            {(
              [
                ['list', List, m.files_view_list()],
                ['grid', LayoutGrid, m.files_view_grid()],
              ] as const
            ).map(([value, Icon, label]) => (
              <Tooltip key={value}>
                <TooltipTrigger render={<ToggleGroupItem value={value} aria-label={label} />}>
                  <Icon aria-hidden />
                </TooltipTrigger>
                <TooltipContent>{label}</TooltipContent>
              </Tooltip>
            ))}
          </ToggleGroup>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" />}>
              <Plus aria-hidden />
              {m.files_new()}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => setAction({ kind: 'new-folder', parentId: currentId })}
              >
                <FolderPlus aria-hidden />
                {m.files_new_folder()}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setAction({ kind: 'new-link', folderId: currentId })}
              >
                <Link2 aria-hidden />
                {m.files_add_link()}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={pickFiles}>
            <Upload aria-hidden />
            {m.files_upload()}
          </Button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            aria-hidden
            tabIndex={-1}
            onChange={(event) => {
              uploads.start([...(event.target.files ?? [])])
              event.target.value = ''
            }}
          />
        </div>
      </div>

      {/* Always one line tall, so opening a folder or searching never moves the list. */}
      <div className="flex h-8 items-center">
        {searching ? (
          <p className="truncate text-sm text-muted-foreground">
            {m.files_search_results_for({ query: search.trim() })}
          </p>
        ) : (
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                {trail.length === 0 ? (
                  <BreadcrumbPage>{m.files_all_files()}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    render={(props) => (
                      <button type="button" {...props} onClick={() => setFolderId(null)} />
                    )}
                  >
                    {m.files_all_files()}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {trail.map((crumb, index) => (
                <BreadcrumbItem key={crumb.id}>
                  <BreadcrumbSeparator />
                  {index === trail.length - 1 ? (
                    <BreadcrumbPage>{crumb.name}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink
                      render={(props) => (
                        <button type="button" {...props} onClick={() => setFolderId(crumb.id)} />
                      )}
                    >
                      {crumb.name}
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
        )}
      </div>

      {searching ? (
        <SearchResults
          nameMatches={nameMatches}
          hits={contentSearch.data?.results ?? []}
          loading={query.trim().length >= 2 && (contentSearch.isFetching || search !== query)}
          pendingNames={(contentSearch.data?.pending_items ?? []).map((p) => p.display_name)}
          onOpenItem={open}
          onOpenHit={(hit) =>
            setPreview({ itemId: hit.item_id, page: hit.page_from, terms: searchTerms(query) })
          }
          onClear={() => setSearch('')}
        />
      ) : empty ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderOpen aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{m.files_empty_title()}</EmptyTitle>
            <EmptyDescription>{m.files_empty_description()}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={pickFiles}>{m.files_upload()}</Button>
          </EmptyContent>
        </Empty>
      ) : childFolders.length === 0 && childItems.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderOpen aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{m.files_folder_empty_title()}</EmptyTitle>
            <EmptyDescription>{m.files_folder_empty_description()}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={pickFiles}>{m.files_upload()}</Button>
          </EmptyContent>
        </Empty>
      ) : (
        <FileBrowser
          folders={childFolders}
          items={childItems}
          view={view}
          handlers={{ open, openFolder: setFolderId, act: setAction }}
        />
      )}

      <UsageBar />

      {dragging ? (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
        >
          <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-primary px-16 py-12 text-primary">
            <Upload className="size-8" />
            <p className="text-sm font-medium">
              {m.files_drop_here({ folder: trail.at(-1)?.name ?? m.files_all_files() })}
            </p>
          </div>
        </div>
      ) : null}

      {uploads.panel}
      {uploads.dialog}
      {link.dialog}
      <ItemDialogs
        courseId={courseId}
        folders={list.folders}
        items={list.items}
        action={action}
        onClose={() => setAction(null)}
      />
      <PreviewDialog target={preview} onClose={() => setPreview(null)} />
    </div>
  )
}
