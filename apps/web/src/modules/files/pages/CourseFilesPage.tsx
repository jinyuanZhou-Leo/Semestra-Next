import type { FilesItemList, ItemOut } from '@semestra/api-client'
import {
  FolderInput,
  FolderOpen,
  FolderPlus,
  Link2,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useRef, useState } from 'react'
import type { PageProps } from '@/app/extensions'
import { useUiPref } from '@/app/ui-pref'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { FileDropOverlay } from '@/components/FileDropOverlay'
import { useDialogTarget } from '@/lib/dialog-target'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { useExternalLink } from '../components/ExternalLink'
import { FileDragArea, useDropFolder } from '../components/FileDrag'
import { FileBrowser, type Selection, SortMenu, ViewToggle } from '../components/FileBrowser'
import { type ItemAction, ItemDialogs } from '../components/ItemDialogs'
import { PreviewDialog, type PreviewTarget } from '../components/PreviewDialog'
import { SearchResults, useContentSearch } from '../components/SearchResults'
import { type Uploads, useUploads } from '../components/Uploads'
import { UsageBar } from '../components/UsageBar'
import { type Target, targetKey } from '../folders'
import { searchTerms } from '../highlight'
import { useDebounced, useFileDrop } from '../hooks'
import { useCourseFiles } from '../queries'

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

/**
 * A course's files with its folders, searching and uploads. On the term page it is one course
 * folder: `name` is the course's crumb and `up` the crumb before it, back to the courses.
 */
export function CourseFiles({
  list,
  courseId,
  programId,
  name,
  up,
  uploads: shared,
}: {
  list: FilesItemList
  courseId: string
  programId: string
  name?: string
  up?: { label: string; onClick: () => void }
  /** Uploads owned by the term page, so they outlive leaving this course. */
  uploads?: Uploads
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [view] = useUiPref<'list' | 'grid'>('files.view', 'list')
  const [folderId, openFolder] = useState<string | null>(null)
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(new Set())
  const [search, setSearch] = useState('')
  const action = useDialogTarget<ItemAction>()
  const preview = useDialogTarget<PreviewTarget>()
  const link = useExternalLink()

  // The folder may have been deleted (here or in another tab).
  const folder = list.folders.find((f) => f.id === folderId) ?? null
  const currentId = folder?.id ?? null
  const own = useUploads()
  const uploads = shared ?? own
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
  // Selection belongs to the folder shown: opening another one starts over.
  const setFolderId = (id: string | null) => {
    openFolder(id)
    setSelectedKeys(new Set())
  }
  const shown: Target[] = [
    ...childFolders.map((f): Target => ({ type: 'folder', folder: f })),
    ...childItems.map((i): Target => ({ type: 'item', item: i })),
  ]
  const selected = shown.filter((t) => selectedKeys.has(targetKey(t)))
  const clearSelection = () => setSelectedKeys(new Set())
  const selection: Selection = {
    has: (t) => selectedKeys.has(targetKey(t)),
    toggle: (t) =>
      setSelectedKeys((prev) => {
        const next = new Set(prev)
        const key = targetKey(t)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      }),
    all: selected.length === 0 ? false : selected.length === shown.length ? true : 'some',
    toggleAll: () =>
      setSelectedKeys(selected.length === shown.length ? new Set() : new Set(shown.map(targetKey))),
    active: selected.length > 0,
  }
  const selecting = selected.length > 0 && !searching

  const needle = search.trim().toLowerCase()
  const nameMatches = needle
    ? list.items.filter((i) => i.display_name.toLowerCase().includes(needle))
    : []

  const open = (item: ItemOut) => {
    if (item.kind === 'link' && item.url) link.open(item.url)
    else preview.show({ itemId: item.id })
  }
  const pickFiles = () => fileInput.current?.click()
  const empty = list.items.length === 0 && list.folders.length === 0

  return (
    <FileDragArea
      courseId={courseId}
      folders={list.folders}
      selected={selected}
      onMoved={clearSelection}
    >
      <div className="relative flex flex-col gap-3">
        <div className="flex min-h-9 flex-wrap items-center gap-2">
          {selecting ? (
            <SelectionBar
              count={selected.length}
              onMove={() => action.show({ kind: 'move', targets: selected })}
              onDelete={() => action.show({ kind: 'delete', targets: selected })}
              onClear={clearSelection}
            />
          ) : (
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
          )}
          <div className="ml-auto flex items-center gap-2">
            {view === 'grid' ? <SortMenu /> : null}
            <ViewToggle />
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" />}>
                <Plus aria-hidden />
                {m.files_new()}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => action.show({ kind: 'new-folder', parentId: currentId })}
                >
                  <FolderPlus aria-hidden />
                  {m.files_new_folder()}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => action.show({ kind: 'new-link', folderId: currentId })}
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
                {up ? (
                  <BreadcrumbItem>
                    <BreadcrumbLink
                      render={(props) => <button type="button" {...props} onClick={up.onClick} />}
                    >
                      {up.label}
                    </BreadcrumbLink>
                    <BreadcrumbSeparator />
                  </BreadcrumbItem>
                ) : null}
                <BreadcrumbItem>
                  {trail.length === 0 ? (
                    <BreadcrumbPage>{name ?? m.files_all_files()}</BreadcrumbPage>
                  ) : (
                    <DropCrumb
                      folderId={null}
                      name={name ?? m.files_all_files()}
                      onClick={() => setFolderId(null)}
                    />
                  )}
                </BreadcrumbItem>
                {trail.map((crumb, index) => (
                  <BreadcrumbItem key={crumb.id}>
                    <BreadcrumbSeparator />
                    {index === trail.length - 1 ? (
                      <BreadcrumbPage>{crumb.name}</BreadcrumbPage>
                    ) : (
                      <DropCrumb
                        folderId={crumb.id}
                        name={crumb.name}
                        onClick={() => setFolderId(crumb.id)}
                      />
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
              preview.show({ itemId: hit.item_id, page: hit.page_from, terms: searchTerms(query) })
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
              act: action.show,
              programId,
              selection,
              drop: {
                over: dropFolderId,
                setOver: setDropFolderId,
                drop: (id, files) => upload(files, id),
              },
            }}
          />
        )}

        <UsageBar />

        {dragging ? (
          // The list stays visible, so a file can be dropped on one of its folders.
          <FileDropOverlay
            label={m.files_drop_here({
              folder:
                list.folders.find((f) => f.id === dropFolderId)?.name ??
                trail.at(-1)?.name ??
                name ??
                m.files_all_files(),
            })}
          />
        ) : null}

        {shared ? null : uploads.panel}
        {shared ? null : uploads.dialog}
        {link.dialog}
        <ItemDialogs
          courseId={courseId}
          folders={list.folders}
          items={list.items}
          action={action.target}
          open={action.open}
          onOpenChangeComplete={action.props.onOpenChangeComplete}
          onClose={action.close}
          onDone={clearSelection}
        />
        <PreviewDialog target={preview.target} {...preview.props} />
      </div>
    </FileDragArea>
  )
}

/** A folder in the breadcrumb: opens it, and takes files dragged onto it. */
function DropCrumb({
  folderId,
  name,
  onClick,
}: {
  folderId: string | null
  name: string
  onClick: () => void
}) {
  const drop = useDropFolder(folderId, name, 'crumb')
  return (
    <BreadcrumbLink
      render={(props) => (
        <button
          type="button"
          {...props}
          ref={drop.attach}
          data-drop-target={drop.over ? '' : undefined}
          onClick={onClick}
        />
      )}
      className="rounded-md transition-[background-color,box-shadow,color] data-drop-target:bg-primary/10 data-drop-target:text-primary data-drop-target:ring-4 data-drop-target:ring-primary/10"
    >
      {name}
    </BreadcrumbLink>
  )
}

/** Takes the search box's place while entries are selected. */
function SelectionBar({
  count,
  onMove,
  onDelete,
  onClear,
}: {
  count: number
  onMove: () => void
  onDelete: () => void
  onClear: () => void
}) {
  return (
    <div className="flex h-9 animate-in items-center gap-1 rounded-full bg-muted pr-1 pl-4 text-sm duration-150 fade-in-0">
      <span className="mr-1 font-medium tabular-nums">{m.files_selected_count({ count })}</span>
      <Button variant="ghost" size="sm" onClick={onMove}>
        <FolderInput aria-hidden />
        {m.files_move_to()}
      </Button>
      <Button variant="destructive" size="sm" onClick={onDelete}>
        <Trash2 aria-hidden />
        {m.common_delete()}
      </Button>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={m.files_clear_selection()}
              onClick={onClear}
            />
          }
        >
          <X aria-hidden />
        </TooltipTrigger>
        <TooltipContent>{m.files_clear_selection()}</TooltipContent>
      </Tooltip>
    </div>
  )
}
