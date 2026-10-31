import type { FilesItemList, ItemOut } from '@semestra/api-client'
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
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/ui/input-group'
import { SEGMENT, SEGMENTED } from '@/lib/segmented'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { useExternalLink } from '../components/ExternalLink'
import { FileBrowser, SortMenu } from '../components/FileBrowser'
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
  list: FilesItemList
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
  const uploads = useUploads()
  const upload = (files: readonly File[], into: string | null = currentId) =>
    uploads.start(files, { courseId, folderId: into, existing: list.items })
  const dragging = useFileDrop(upload)
  // The folder the dragged files are over, if any; otherwise they go into the open one.
  const [dropFolderId, setDropFolderId] = useState<string | null>(null)

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
    <div className="relative flex flex-col gap-3">
      <div className="flex min-h-9 flex-wrap items-center gap-2">
        <InputGroup className="w-64">
          <InputGroupInput
            type="search"
            aria-label={m.files_search()}
            placeholder={m.files_search()}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <InputGroupAddon>
            <Search aria-hidden />
          </InputGroupAddon>
        </InputGroup>
        <div className="ml-auto flex items-center gap-2">
          {view === 'grid' ? <SortMenu /> : null}
          <ToggleGroup
            aria-label={m.files_view()}
            size="sm"
            className={SEGMENTED}
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
                <TooltipTrigger
                  render={<ToggleGroupItem value={value} aria-label={label} className={SEGMENT} />}
                >
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
              upload([...(event.target.files ?? [])])
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
          handlers={{
            open,
            openFolder: setFolderId,
            act: setAction,
            programId,
            drop: {
              folderId: dropFolderId,
              over: setDropFolderId,
              into: (id, files) => upload(files, id),
            },
          }}
        />
      )}

      <UsageBar />

      {dragging ? (
        // The list stays visible, so a file can be dropped on one of its folders.
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-2 z-20 flex flex-col justify-end rounded-3xl border-2 border-dashed border-primary bg-primary/5"
        >
          <div className="sticky bottom-6 mx-auto mb-6 flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg">
            <Upload aria-hidden className="size-4" />
            {m.files_drop_here({
              folder:
                list.folders.find((f) => f.id === dropFolderId)?.name ??
                trail.at(-1)?.name ??
                m.files_all_files(),
            })}
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
