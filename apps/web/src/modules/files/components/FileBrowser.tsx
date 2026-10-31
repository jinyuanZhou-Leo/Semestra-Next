import type { FolderOut, ItemOut } from '@semestra/api-client'
import {
  filesItemUpdateMutation,
  filesItemReprocessMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  type CellContext,
  FlexRender,
  type Row,
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
  Download,
  FileSearch,
  Folder,
  FolderInput,
  MoreHorizontal,
  Pencil,
  RotateCw,
  Pin,
  Trash2,
} from 'lucide-react'
import { createContext, use, useRef, useState } from 'react'
import { useExtensions } from '@/app/registry'
import { useUiPref } from '@/app/ui-pref'
import { formatBytes, formatDateTime } from '@/lib/format'
import { toastError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { previewKind, typeLabel } from '../kinds'
import { contentUrl, invalidateFiles, pageImageUrl } from '../queries'
import { FILE_ITEM_ACTIONS, type FileItemAction } from '../types'
import type { ItemAction } from './ItemDialogs'
import { StatusCell } from './StatusCell'
import { VirtualBody } from './VirtualBody'
import { FileIcon } from './FileIcon'

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() })
const column = createColumnHelper<typeof features, ItemOut>()
type CellProps = CellContext<typeof features, ItemOut>

export type BrowserHandlers = {
  /** Preview a file, or open a link (after the external-site check). */
  open: (item: ItemOut) => void
  openFolder: (folderId: string) => void
  act: (action: ItemAction) => void
  /** Read-only lists (the term page) hide editing. */
  readOnly?: boolean
  /** The course's Program, for the menu entries other modules add (`files.itemActions`). */
  programId?: string
}

const BrowserContext = createContext<BrowserHandlers | null>(null)

function useHandlers(): BrowserHandlers {
  const handlers = use(BrowserContext)
  if (!handlers) throw new Error('File cells must render inside FileBrowser')
  return handlers
}

function usePinToggle() {
  const queryClient = useQueryClient()
  return useMutation({
    ...filesItemUpdateMutation(),
    onError: toastError,
    onSuccess: () => invalidateFiles(queryClient),
  })
}

function NameCell({ row }: CellProps) {
  const { open } = useHandlers()
  const item = row.original
  return (
    <button
      type="button"
      onClick={() => open(item)}
      className="flex max-w-full items-center gap-2.5 text-left hover:underline"
    >
      <FileIcon item={item} aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{item.display_name}</span>
    </button>
  )
}

function SizeCell({ row }: CellProps) {
  return row.original.kind === 'link' ? (
    <span className="text-muted-foreground">—</span>
  ) : (
    <span className="tabular-nums">{formatBytes(row.original.size_bytes)}</span>
  )
}

function UpdatedCell({ row }: CellProps) {
  return formatDateTime(row.original.updated_at)
}

function StatusColumnCell({ row }: CellProps) {
  // A fixed height, so a row does not grow or shrink as its file moves through the pipeline.
  return (
    <div className="flex h-8 items-center">
      <StatusCell item={row.original} />
    </div>
  )
}

export function PinButton({ item }: { item: ItemOut }) {
  const toggle = usePinToggle()
  const label = item.pinned ? m.files_unpin() : m.files_pin()
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-pressed={item.pinned}
            disabled={toggle.isPending}
            onClick={() =>
              toggle.mutate({ path: { item_id: item.id }, body: { pinned: !item.pinned } })
            }
          />
        }
      >
        <Pin aria-hidden className={cn(item.pinned && 'fill-current text-primary')} />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function PinCell({ row }: CellProps) {
  const { readOnly } = useHandlers()
  return readOnly ? null : <PinButton item={row.original} />
}

export function ItemMenu({ item }: { item: ItemOut }) {
  const { act, programId } = useHandlers()
  const actions = useExtensions<FileItemAction>(FILE_ITEM_ACTIONS).filter((a) => a.accepts(item))
  const canReprocess =
    item.kind === 'file' && (item.doc_status === 'ready' || item.doc_status === 'failed')
  const canIndex = item.kind === 'file' && item.doc_status === 'none'
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={m.files_actions({ name: item.display_name })}
                />
              }
            />
          }
        >
          <MoreHorizontal aria-hidden />
        </TooltipTrigger>
        <TooltipContent>{m.files_more_actions()}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        className={programId && actions.length > 0 ? 'w-72' : undefined}
      >
        <DropdownMenuItem onClick={() => act({ kind: 'rename', target: { type: 'item', item } })}>
          <Pencil aria-hidden />
          {m.files_rename()}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => act({ kind: 'move', item })}>
          <FolderInput aria-hidden />
          {m.files_move()}
        </DropdownMenuItem>
        {item.kind === 'file' ? (
          <DropdownMenuItem
            // oxlint-disable-next-line jsx-a11y/anchor-has-content -- the content arrives through `props`
            render={(props) => <a {...props} href={contentUrl(item.id, 'attachment')} download />}
          >
            <Download aria-hidden />
            {m.files_download()}
          </DropdownMenuItem>
        ) : null}
        {canReprocess || canIndex ? <ReprocessItem item={item} /> : null}
        {programId && actions.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            {actions.map((action) => (
              <DropdownMenuItem
                key={action.id}
                onClick={() => void action.run({ programId, item })}
              >
                <action.icon aria-hidden />
                <span className="min-w-0">
                  <span className="block">{action.title()}</span>
                  {action.description ? (
                    <span className="block text-xs text-muted-foreground">
                      {action.description()}
                    </span>
                  ) : null}
                </span>
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => act({ kind: 'delete', target: { type: 'item', item } })}
        >
          <Trash2 aria-hidden />
          {m.common_delete()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ReprocessItem({ item }: { item: ItemOut }) {
  const queryClient = useQueryClient()
  // The menu closes on click, so the mutation lives in the item and reports through toasts.
  const reprocess = useMutation({
    ...filesItemReprocessMutation(),
    onError: toastError,
    onSuccess: () => invalidateFiles(queryClient),
  })
  return (
    <DropdownMenuItem onClick={() => reprocess.mutate({ path: { item_id: item.id } })}>
      {item.doc_status === 'none' ? <FileSearch aria-hidden /> : <RotateCw aria-hidden />}
      {item.doc_status === 'none' ? m.files_index_now() : m.files_reprocess()}
    </DropdownMenuItem>
  )
}

function ActionsCell({ row }: CellProps) {
  const { readOnly } = useHandlers()
  return readOnly ? null : <ItemMenu item={row.original} />
}

function FolderMenu({ folder }: { folder: FolderOut }) {
  const { act } = useHandlers()
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={m.files_actions({ name: folder.name })}
                />
              }
            />
          }
        >
          <MoreHorizontal aria-hidden />
        </TooltipTrigger>
        <TooltipContent>{m.files_more_actions()}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => act({ kind: 'rename', target: { type: 'folder', folder } })}
        >
          <Pencil aria-hidden />
          {m.files_rename()}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => act({ kind: 'delete', target: { type: 'folder', folder } })}
        >
          <Trash2 aria-hidden />
          {m.common_delete()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function compareText(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

const columns = column.columns([
  column.accessor((i) => i.display_name, {
    id: 'name',
    header: () => m.files_name(),
    sortFn: (a, b) => compareText(a.original.display_name, b.original.display_name),
    cell: NameCell,
  }),
  column.accessor((i) => i.size_bytes, {
    id: 'size',
    header: () => m.files_size(),
    sortFn: (a, b) => a.original.size_bytes - b.original.size_bytes,
    cell: SizeCell,
  }),
  column.accessor((i) => i.updated_at, {
    id: 'updated',
    header: () => m.files_modified(),
    sortFn: (a, b) => compareText(a.original.updated_at, b.original.updated_at),
    cell: UpdatedCell,
  }),
  column.display({
    id: 'status',
    header: () => <span className="sr-only">{m.files_status()}</span>,
    cell: StatusColumnCell,
    enableSorting: false,
  }),
  column.display({
    id: 'pin',
    header: () => <span className="sr-only">{m.files_pin()}</span>,
    cell: PinCell,
    enableSorting: false,
  }),
  column.display({
    id: 'actions',
    header: () => <span className="sr-only">{m.files_more_actions()}</span>,
    cell: ActionsCell,
    enableSorting: false,
  }),
])

// The table is `table-fixed`, so these are the column widths; the name takes the rest. An icon
// column fits its 32 px button between 8 px paddings, or the button pokes out of the table.
const ICON_COLUMN = 'w-12 px-2'
const WIDTHS: Record<string, string> = {
  size: 'w-24',
  updated: 'w-44',
  status: 'w-52',
  pin: ICON_COLUMN,
  actions: ICON_COLUMN,
}

const columnCount = columns.length

const DEFAULT_SORT: SortingState = [{ id: 'name', desc: false }]

/** The sort the user picked, shared by the list and grid views of every course. */
export function useFileSort() {
  return useUiPref<SortingState>('files.sort', DEFAULT_SORT)
}

const SORT_FIELDS = [
  ['name', () => m.files_name()],
  ['size', () => m.files_size()],
  ['updated', () => m.files_modified()],
] as const

/** The grid has no column headers, so its sort is picked from this menu. */
export function SortMenu() {
  const [sorting, setSorting] = useFileSort()
  const current = sorting[0] ?? DEFAULT_SORT[0]
  const label = SORT_FIELDS.find(([id]) => id === current?.id)?.[1]() ?? m.files_name()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        {current?.desc ? <ArrowDown aria-hidden /> : <ArrowUp aria-hidden />}
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{m.files_sort_by()}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={current?.id}
            onValueChange={(id) => setSorting([{ id, desc: current?.desc ?? false }])}
          >
            {SORT_FIELDS.map(([id, text]) => (
              <DropdownMenuRadioItem key={id} value={id}>
                {text()}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={current?.desc ? 'desc' : 'asc'}
          onValueChange={(dir) => setSorting([{ id: current?.id ?? 'name', desc: dir === 'desc' }])}
        >
          <DropdownMenuRadioItem value="asc">{m.files_sort_ascending()}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="desc">{m.files_sort_descending()}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function FolderTile({ folder }: { folder: FolderOut }) {
  const { openFolder, readOnly } = useHandlers()
  return (
    <div className="group relative flex h-14 items-center gap-2.5 rounded-xl border bg-card px-3 hover:bg-muted/50">
      <button
        type="button"
        onClick={() => openFolder(folder.id)}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left text-sm after:absolute after:inset-0"
      >
        <Folder aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">{folder.name}</span>
      </button>
      {readOnly ? null : (
        <div className="relative">
          <FolderMenu folder={folder} />
        </div>
      )}
    </div>
  )
}

function ItemTile({ item }: { item: ItemOut }) {
  const { open, readOnly } = useHandlers()
  const [broken, setBroken] = useState(false)
  // Page images are only made for PDFs and images; anything else gets its icon.
  const kind = previewKind(item)
  const thumbnail =
    !broken &&
    (kind === 'pdf' || kind === 'image') &&
    item.doc_status === 'ready' &&
    (item.page_count ?? 0) > 0
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border bg-card">
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted/50">
        {thumbnail ? (
          <img
            src={pageImageUrl(item.id, 1)}
            alt=""
            loading="lazy"
            onError={() => setBroken(true)}
            className="size-full object-cover object-top"
          />
        ) : (
          <FileIcon item={item} aria-hidden className="size-10 text-muted-foreground" />
        )}
      </div>
      <div className="flex h-12 items-center gap-1 px-3">
        <button
          type="button"
          onClick={() => open(item)}
          className="min-w-0 flex-1 text-left text-sm after:absolute after:inset-0"
        >
          <span className="block truncate font-medium">{item.display_name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {[typeLabel(item), item.kind === 'file' ? formatBytes(item.size_bytes) : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </button>
        <div className="relative flex items-center">
          <StatusCell item={item} compact />
          {readOnly ? null : (
            <>
              <PinButton item={item} />
              <ItemMenu item={item} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function FileRow({
  row,
  measure,
  index,
}: {
  row: Row<typeof features, ItemOut>
  measure?: (node: Element | null) => void
  index?: number
}) {
  return (
    <TableRow ref={measure} data-index={index}>
      {row.getAllCells().map((cell) => (
        <TableCell key={cell.id} className={cn('py-2', WIDTHS[cell.column.id])}>
          <FlexRender cell={cell} />
        </TableCell>
      ))}
    </TableRow>
  )
}

/** Lists this long render only the rows near the screen (LMS syncs bring hundreds of files). */
const VIRTUAL_FROM = 100

/**
 * Folders, then files, as a sortable table or a grid of tiles (M07 §6.1). Folders always come
 * first, by name; the chosen sort applies to files.
 */
export function FileBrowser({
  folders,
  items,
  view,
  handlers,
}: {
  folders: readonly FolderOut[]
  items: readonly ItemOut[]
  view: 'list' | 'grid'
  handlers: BrowserHandlers
}) {
  const [sorting, setSorting] = useFileSort()
  const wrapper = useRef<HTMLDivElement>(null)
  const table = useTable({
    features,
    columns,
    data: items as ItemOut[],
    getRowId: (item) => item.id,
    state: { sorting },
    onSortingChange: (updater) =>
      setSorting(typeof updater === 'function' ? updater(sorting) : updater),
  })
  const sortedFolders = folders.toSorted((a, b) => compareText(a.name, b.name))
  // Pinned files stay on top whatever the sort.
  const rows = table
    .getRowModel()
    .rows.toSorted((a, b) => Number(b.original.pinned) - Number(a.original.pinned))

  if (view === 'grid') {
    return (
      <BrowserContext value={handlers}>
        <div className="space-y-3">
          {sortedFolders.length > 0 ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3">
              {sortedFolders.map((folder) => (
                <FolderTile key={folder.id} folder={folder} />
              ))}
            </div>
          ) : null}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3">
            {rows.map((row) => (
              <ItemTile key={row.id} item={row.original} />
            ))}
          </div>
        </div>
      </BrowserContext>
    )
  }

  return (
    <BrowserContext value={handlers}>
      {/* The table scrolls sideways inside `Table`'s own container; this only draws the frame. */}
      <div ref={wrapper} className="overflow-hidden rounded-2xl border">
        <Table className="min-w-2xl table-fixed">
          <TableHeader className="bg-muted/50">
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="hover:bg-transparent">
                {group.headers.map((h) => {
                  const sorted = h.column.getIsSorted()
                  return (
                    <TableHead
                      key={h.id}
                      aria-sort={
                        sorted === 'asc'
                          ? 'ascending'
                          : sorted === 'desc'
                            ? 'descending'
                            : undefined
                      }
                      className={cn('h-auto py-2 text-muted-foreground', WIDTHS[h.column.id])}
                    >
                      {h.column.getCanSort() ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={h.column.getToggleSortingHandler()}
                          className="-ml-2 h-auto px-2 text-muted-foreground"
                        >
                          <FlexRender header={h} />
                          {sorted === 'asc' ? (
                            <ArrowUp aria-hidden className="size-3" />
                          ) : sorted === 'desc' ? (
                            <ArrowDown aria-hidden className="size-3" />
                          ) : null}
                        </Button>
                      ) : (
                        <FlexRender header={h} />
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {sortedFolders.map((folder) => (
              <TableRow key={folder.id}>
                <TableCell className="py-2" colSpan={columnCount - 1}>
                  <button
                    type="button"
                    onClick={() => handlers.openFolder(folder.id)}
                    className="flex max-w-full items-center gap-2.5 font-medium hover:underline"
                  >
                    <Folder aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{folder.name}</span>
                  </button>
                </TableCell>
                <TableCell className={cn('py-2', ICON_COLUMN)}>
                  {handlers.readOnly ? null : <FolderMenu folder={folder} />}
                </TableCell>
              </TableRow>
            ))}
            {rows.length < VIRTUAL_FROM
              ? rows.map((row) => <FileRow key={row.id} row={row} />)
              : null}
          </TableBody>
          {rows.length >= VIRTUAL_FROM ? (
            <VirtualBody
              count={rows.length}
              scrollerOf={wrapper}
              renderRow={(index, measure) => {
                const row = rows[index]
                return row ? (
                  <FileRow key={row.id} row={row} measure={measure} index={index} />
                ) : null
              }}
            />
          ) : null}
        </Table>
      </div>
    </BrowserContext>
  )
}
