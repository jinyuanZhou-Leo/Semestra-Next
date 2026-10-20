import type { FolderOut, ItemOut } from '@semestra/api-client'
import {
  filesItemUpdateMutation,
  filesItemReprocessMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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
  Download,
  Folder,
  FolderInput,
  MoreHorizontal,
  Pencil,
  RotateCw,
  Pin,
  Trash2,
} from 'lucide-react'
import { createContext, use, useState } from 'react'
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
import type { ItemAction } from './ItemDialogs'
import { StatusCell } from './StatusCell'
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
      className="flex max-w-full min-w-0 items-center gap-2.5 text-left hover:underline"
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
  return <span className="whitespace-nowrap">{formatDateTime(row.original.updated_at)}</span>
}

function StatusColumnCell({ row }: CellProps) {
  return <StatusCell item={row.original} />
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
  const { act } = useHandlers()
  const canReprocess =
    item.kind === 'file' && (item.doc_status === 'ready' || item.doc_status === 'failed')
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
      <DropdownMenuContent align="end">
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
        {canReprocess ? <ReprocessItem item={item} /> : null}
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
      <RotateCw aria-hidden />
      {m.files_reprocess()}
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

const WIDTHS: Record<string, string> = {
  size: 'w-24',
  updated: 'w-44',
  status: 'w-20',
  pin: 'w-10',
  actions: 'w-10',
}

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
          <StatusCell item={item} />
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
      <div className="overflow-x-auto rounded-2xl border border-border">
        <Table className="min-w-2xl table-fixed">
          <TableHeader className="bg-muted/50">
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="hover:bg-transparent">
                {group.headers.map((h) => {
                  const sorted = h.column.getIsSorted()
                  return (
                    <TableHead
                      key={h.id}
                      scope="col"
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
            {sortedFolders.map((folder) => (
              <TableRow key={folder.id}>
                <TableCell className="py-2" colSpan={5}>
                  <button
                    type="button"
                    onClick={() => handlers.openFolder(folder.id)}
                    className="flex max-w-full min-w-0 items-center gap-2.5 font-medium hover:underline"
                  >
                    <Folder aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{folder.name}</span>
                  </button>
                </TableCell>
                <TableCell className="py-2">
                  {handlers.readOnly ? null : <FolderMenu folder={folder} />}
                </TableCell>
              </TableRow>
            ))}
            {rows.map((row) => (
              <TableRow key={row.id}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id} className="py-2">
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </BrowserContext>
  )
}
