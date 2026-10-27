import type { FileMeta, Folder as FolderOut } from '@semestra/api-client'
import { lmsFileSearchOptions, lmsFolderGetOptions } from '@semestra/api-client/react-query'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  type CellContext,
  type SortingState,
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import {
  ArrowDown,
  ArrowUp,
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  Lock,
  Presentation,
  Search,
} from 'lucide-react'
import { Fragment, useState } from 'react'
import { useUiPref } from '@/app/ui-pref'
import { formatBytes, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
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
import { Button } from '@/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/ui/input-group'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { CanvasBoundary } from '../CanvasBoundary'
import { useCanvasPage } from '../context'
import { FileActions } from './FilePreview'

/** Canvas needs two characters to search (`search_term`). */
const MIN_TERM = 2

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() })
const column = createColumnHelper<typeof features, FileMeta>()
type CellProps = CellContext<typeof features, FileMeta>

function compareText(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

/** A file's icon by its type: documents, slides, sheets, archives, images, video, the rest. */
function FileIcon({ file }: { file: FileMeta }) {
  const mime = file.mime_type ?? ''
  const name = file.name.toLowerCase()
  let Icon = File
  if (mime.startsWith('image/')) Icon = FileImage
  else if (mime.startsWith('video/')) Icon = FileVideo
  else if (/presentationml|powerpoint/.test(mime) || /\.pptx?$/.test(name)) Icon = Presentation
  else if (/spreadsheetml|ms-excel|csv/.test(mime) || /\.(xlsx?|csv)$/.test(name))
    Icon = FileSpreadsheet
  else if (/zip|compressed|gzip|x-tar/.test(mime) || /\.(zip|gz|tar|7z|rar)$/.test(name))
    Icon = FileArchive
  else if (/pdf|wordprocessingml|msword|^text\//.test(mime)) Icon = FileText
  return <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
}

function NameCell({ row }: CellProps) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <FileIcon file={row.original} />
      <span className="truncate">{row.original.name}</span>
    </span>
  )
}

const SizeCell = ({ row }: CellProps) =>
  row.original.size_bytes == null ? '—' : formatBytes(row.original.size_bytes)

const UpdatedCell = ({ row }: CellProps) =>
  row.original.updated_at ? formatDateTime(row.original.updated_at) : '—'

function ActionsCell({ row }: CellProps) {
  const f = row.original
  return f.locked ? <LockedMark /> : <FileActions fileId={f.external_id} name={f.name} />
}

/** Sits where the first action button would, so locked and open rows line up. */
function LockedMark() {
  return (
    <span className="flex size-8 items-center justify-center">
      <Lock aria-label={m.canvas_tab_item_locked()} className="size-3.5 text-muted-foreground" />
    </span>
  )
}

const columns = column.columns([
  column.accessor((f) => f.name, {
    id: 'name',
    header: () => m.canvas_tab_column_name(),
    sortFn: (a, b) => compareText(a.original.name, b.original.name),
    cell: NameCell,
  }),
  column.accessor((f) => f.size_bytes, {
    id: 'size',
    header: () => m.canvas_tab_column_size(),
    sortFn: (a, b) => (a.original.size_bytes ?? -1) - (b.original.size_bytes ?? -1),
    cell: SizeCell,
  }),
  column.accessor((f) => f.updated_at, {
    id: 'updated',
    header: () => m.canvas_tab_column_updated(),
    sortFn: (a, b) => compareText(a.original.updated_at ?? '', b.original.updated_at ?? ''),
    cell: UpdatedCell,
  }),
  column.display({
    id: 'actions',
    header: () => <span className="sr-only">{m.canvas_tab_column_actions()}</span>,
    cell: ActionsCell,
    enableSorting: false,
  }),
])

const WIDTHS: Record<string, string> = { size: 'w-24', updated: 'w-44', actions: 'w-28' }
/** Inset of the first and last column inside the table's rounded border. */
const EDGE = 'first:pl-4 last:pr-3'
const CELL_CLASS: Record<string, string> = {
  size: 'text-muted-foreground tabular-nums',
  updated: 'text-muted-foreground tabular-nums',
}

const DEFAULT_SORT: SortingState = [{ id: 'name', desc: false }]

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
    <div className="flex flex-1 flex-col gap-4">
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
        <div className="flex flex-1 flex-col gap-3">
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
            <FileTable
              folders={data.folders}
              files={data.files}
              onOpenFolder={(f) => go({ tab: 'files', ref: f.external_id })}
            />
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

/**
 * Folders (in Canvas's order) above the files, which sort by the column the user picks, like the
 * course files page (M07 §6.1).
 */
function FileTable({
  folders = [],
  files,
  onOpenFolder,
}: {
  folders?: FolderOut[]
  files: FileMeta[]
  onOpenFolder?: (folder: FolderOut) => void
}) {
  const [sorting, setSorting] = useUiPref<SortingState>('canvas-tab.files_sort', DEFAULT_SORT)
  const table = useTable({
    features,
    columns,
    data: files,
    getRowId: (f) => f.external_id,
    state: { sorting },
    onSortingChange: (updater) =>
      setSorting(typeof updater === 'function' ? updater(sorting) : updater),
  })
  return (
    <div className="overflow-hidden rounded-2xl border">
      <Table className="min-w-xl table-fixed">
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((h) => {
                const sorted = h.column.getIsSorted()
                return (
                  <TableHead
                    key={h.id}
                    scope="col"
                    aria-sort={
                      sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined
                    }
                    className={cn(EDGE, WIDTHS[h.column.id])}
                  >
                    {h.column.getCanSort() ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={h.column.getToggleSortingHandler()}
                        className="-ml-2 h-auto px-2 text-muted-foreground hover:text-foreground"
                      >
                        <table.FlexRender header={h} />
                        {sorted === 'asc' ? (
                          <ArrowUp aria-hidden className="size-3" />
                        ) : sorted === 'desc' ? (
                          <ArrowDown aria-hidden className="size-3" />
                        ) : null}
                      </Button>
                    ) : (
                      <table.FlexRender header={h} />
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {folders.map((f) => (
            <TableRow key={f.external_id}>
              <TableCell className={EDGE}>
                <button
                  type="button"
                  onClick={() => onOpenFolder?.(f)}
                  className="flex max-w-full min-w-0 items-center gap-2.5 font-medium hover:underline"
                >
                  <Folder aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{f.name}</span>
                </button>
              </TableCell>
              <TableCell className={cn(EDGE, CELL_CLASS.size)}>
                {m.canvas_tab_module_items({
                  count: (f.files_count ?? 0) + (f.folders_count ?? 0),
                })}
              </TableCell>
              <TableCell className={EDGE} />
              <TableCell className={EDGE}>
                {/* As tall as the action buttons, so every row has the same height. */}
                {f.locked ? <LockedMark /> : <span aria-hidden className="block size-8" />}
              </TableCell>
            </TableRow>
          ))}
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getAllCells().map((cell) => (
                <TableCell key={cell.id} className={cn(EDGE, CELL_CLASS[cell.column.id])}>
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
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
          <FileTable files={data.items} />
          {data.truncated ? (
            <p className="text-xs text-muted-foreground">{m.canvas_tab_files_truncated()}</p>
          ) : null}
        </div>
      )}
    </CanvasBoundary>
  )
}
