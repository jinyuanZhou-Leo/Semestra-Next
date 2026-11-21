import { useMutation } from '@tanstack/react-query'
import type { FilesItemList, ItemOut } from '@semestra/api-client'
import {
  Download,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Link2,
  Plus,
  Search,
  Upload,
} from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'
import type { PageProps } from '@/app/extensions'
import { useUiPref } from '@/app/ui-pref'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { FileDropOverlay } from '@/components/FileDropOverlay'
import { useDialogTarget } from '@/lib/dialog-target'
import { toastError } from '@/lib/errors'
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
import { Spinner } from '@/ui/spinner'
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
import { RowSelectionContext, useRowSelection } from '@/components/row-selection'
import { SelectionToolbar } from '@/components/SelectionToolbar'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/ui/input-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { useExternalLink } from '@/components/ExternalLink'
import { FileDragArea, useDropFolder } from '../components/FileDrag'
import { FileBrowser, SortMenu, ViewToggle } from '../components/FileBrowser'
import { type ItemAction, ItemDialogs } from '../components/ItemDialogs'
import {
  OrganizeDialog,
  organizeWaits,
  useOrganizeOpen,
  useOrganizeStart,
  useOrganizeState,
} from '../components/OrganizeDialog'
import { PreviewDialog } from '../components/PreviewDialog'
import { SearchResults, useContentSearch } from '../components/SearchResults'
import { type Uploads, useUploads } from '../components/Uploads'
import { UsageBar } from '../components/UsageBar'
import { type Target, targetKey } from '../folders'
import { searchTerms } from '../highlight'
import { matchNames } from '../search-names'
import { useDebounced } from '@/hooks/use-debounced'
import { useFileDrop } from '../hooks'
import { useFilesLocation, usePreviewLocation } from '../location'
import { downloadTarget, useCourseFiles } from '../queries'
import { downloadArchive } from '../download'

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
  const location = useFilesLocation()
  const [search, setSearch] = useState('')
  const action = useDialogTarget<ItemAction>()
  const preview = usePreviewLocation(location)
  const link = useExternalLink()
  const organizeState = useOrganizeState(courseId)
  const organize = useOrganizeStart(courseId)
  const organizing = useOrganizeOpen(location)

  // The folders down to the one last shown: if it goes away (here or in another tab), the page
  // goes up to the nearest one still there.
  const [path, setPath] = useState<readonly string[]>([])
  const byId = new Map(list.folders.map((f) => [f.id, f]))
  const folder =
    byId.get(location.folder ?? '') ??
    (location.folder ? byId.get(path.findLast((id) => byId.has(id)) ?? '') : undefined) ??
    null
  const currentId = folder?.id ?? null
  const trail: { id: string; name: string }[] = []
  let step = folder
  while (step) {
    trail.unshift({ id: step.id, name: step.name })
    step = byId.get(step.parent_id ?? '') ?? null
  }
  const trailIds = trail.map((crumb) => crumb.id)
  if (trailIds.join('/') !== path.join('/')) setPath(trailIds)
  const fileGone = location.file !== null && !list.items.some((i) => i.id === location.file)
  const folderGone = location.folder !== currentId
  useEffect(() => {
    if (folderGone || fileGone)
      location.go({ folder: currentId, file: fileGone ? null : location.file }, { replace: true })
  }, [folderGone, fileGone, currentId, location])

  const own = useUploads()
  const uploads = shared ?? own
  const upload = (files: readonly File[], into: string | null = currentId) =>
    uploads.start(files, { courseId, folderId: into })
  const dragging = useFileDrop(upload)
  // The folder the dragged files are over, if any; otherwise they go into the open one.
  const [dropFolderId, setDropFolderId] = useState<string | null>(null)

  const query = useDebounced(search, 300)
  const searching = search.trim().length > 0
  const contentSearch = useContentSearch(programId, query, { courseIds: [courseId] })

  const childFolders = list.folders.filter((f) => f.parent_id === currentId)
  const childItems = list.items.filter((i) => i.folder_id === currentId)
  const setFolderId = (id: string | null) => location.go({ folder: id, file: null })
  const shown: Target[] = [
    ...childFolders.map((f): Target => ({ type: 'folder', folder: f })),
    ...childItems.map((i): Target => ({ type: 'item', item: i })),
  ]
  const selection = useRowSelection(shown.map(targetKey))
  // Selection belongs to the folder shown: opening another one (or going back) starts over.
  const [selectedIn, setSelectedIn] = useState(currentId)
  if (selectedIn !== currentId) {
    setSelectedIn(currentId)
    selection.clear()
  }
  const checked = new Set(selection.ids)
  const selected = shown.filter((t) => checked.has(targetKey(t)))
  const clearSelection = selection.clear
  const selecting = selected.length > 0 && !searching
  const download = downloadTarget(courseId, selected)
  const archive = useMutation({ mutationFn: downloadArchive, onError: toastError })

  const needle = search.trim()
  const names = matchNames(needle, [list])

  const open = (item: ItemOut) => {
    if (item.kind === 'link' && item.url) link.open(item.url)
    else preview.show({ itemId: item.id })
  }
  const pickFiles = () => fileInput.current?.click()
  const empty = list.items.length === 0 && list.folders.length === 0

  return (
    <RowSelectionContext value={selection}>
      <FileDragArea
        courseId={courseId}
        folders={list.folders}
        selected={selected}
        onMoved={clearSelection}
      >
        <div className="relative flex flex-col gap-3">
          <div className="flex min-h-9 flex-wrap items-center gap-2">
            <SelectionToolbar
              count={selecting ? selected.length : 0}
              countLabel={m.common_selected_count({ count: selected.length })}
              label={m.files_batch_actions()}
              onClear={clearSelection}
              actions={
                <>
                  {download?.archive ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={archive.isPending}
                      onClick={() => archive.mutate(download)}
                    >
                      {archive.isPending ? <Spinner /> : <Download aria-hidden />}
                      {m.files_download()}
                    </Button>
                  ) : download ? (
                    <Button
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      // oxlint-disable-next-line jsx-a11y/anchor-has-content -- the content arrives through `props`
                      render={(props) => <a {...props} href={download.url} download />}
                    >
                      <Download aria-hidden />
                      {m.files_download()}
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => action.show({ kind: 'move', targets: selected })}
                  >
                    {m.files_move_to()}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => action.show({ kind: 'delete', targets: selected })}
                  >
                    {m.common_delete()}
                  </Button>
                </>
              }
            >
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
            </SelectionToolbar>
            <div className="ml-auto flex items-center gap-2">
              {view === 'grid' ? <SortMenu /> : null}
              <ViewToggle />
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="outline"
                      disabled={organize.starting}
                      onClick={() => {
                        // What is under way (or waits for review) opens; otherwise it starts.
                        if (!organizeWaits(organizeState.data)) organize.start()
                        organizing.setOpen(true)
                      }}
                    />
                  }
                >
                  <FolderInput aria-hidden />
                  {m.files_organize()}
                </TooltipTrigger>
                <TooltipContent>{m.files_organize_tooltip()}</TooltipContent>
              </Tooltip>
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
                    <>
                      <BreadcrumbItem>
                        <BreadcrumbLink
                          render={(props) => (
                            <button type="button" {...props} onClick={up.onClick} />
                          )}
                        >
                          {up.label}
                        </BreadcrumbLink>
                      </BreadcrumbItem>
                      <BreadcrumbSeparator />
                    </>
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
                    <Fragment key={crumb.id}>
                      <BreadcrumbSeparator />
                      <BreadcrumbItem>
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
                    </Fragment>
                  ))}
                </BreadcrumbList>
              </Breadcrumb>
            )}
          </div>

          {searching ? (
            <SearchResults
              needle={needle}
              folderMatches={names.folders}
              nameMatches={names.items}
              hits={contentSearch.data?.results ?? []}
              loading={query.trim().length >= 2 && (contentSearch.isFetching || search !== query)}
              pendingNames={(contentSearch.data?.pending_items ?? []).map((p) => p.display_name)}
              onOpenFolder={(f) => {
                setSearch('')
                setFolderId(f.id)
              }}
              onOpenItem={open}
              onOpenHit={(hit) =>
                preview.show({
                  itemId: hit.item_id,
                  page: hit.page_from,
                  terms: searchTerms(query),
                })
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
              list={list}
              folderId={currentId}
              view={view}
              handlers={{
                open,
                openFolder: setFolderId,
                act: action.show,
                programId,
                drop: { setOver: setDropFolderId, drop: (id, files) => upload(files, id) },
              }}
              dropOver={dropFolderId}
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
          <OrganizeDialog
            courseId={courseId}
            list={list}
            open={organizing.open}
            onOpenChange={organizing.setOpen}
          />
        </div>
      </FileDragArea>
    </RowSelectionContext>
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
