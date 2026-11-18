import type { FilesItemList, FolderOut, ItemOut } from '@semestra/api-client'
import {
  filesItemUpdateMutation,
  filesItemKeepOfflineMutation,
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
  Cloud,
  FileOutput,
  HardDrive,
  HardDriveDownload,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  RotateCw,
  Pin,
  Trash2,
} from 'lucide-react'
import { createContext, memo, use, useRef, useState } from 'react'
import { useUiPref } from '@/app/ui-pref'
import { formatBytes, formatDateTime } from '@/lib/format'
import { toastError } from '@/lib/errors'
import { SEGMENT, SEGMENTED } from '@/lib/segmented'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { RowSelectionContext, SelectAllCheckbox, SelectCheckbox } from '@/components/row-selection'
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
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { DROP_TARGET, type DropTargets, dropTargetProps } from '../hooks'
import { previewKind, typeLabel } from '../kinds'
import { contentUrl, invalidateFiles, pageImageUrl } from '../queries'
import { type Target, compareNames, targetKey } from '../folders'
import { useDragSource, useDropFolder } from './FileDrag'
import type { ItemAction } from './ItemDialogs'
import { StatusCell } from './StatusCell'
import { VirtualBody } from './VirtualBody'
import { FileIcon } from './FileIcon'
import { useItemActions } from './ItemActions'

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() })
const column = createColumnHelper<typeof features, ItemOut>()
type CellProps = CellContext<typeof features, ItemOut>

export type BrowserHandlers = {
  /** Preview a file, or open a link (after the external-site check). */
  open: (item: ItemOut) => void
  openFolder: (folderId: string) => void
  act: (action: ItemAction) => void
  /** The course's Program, for the menu entries other modules add (`files.itemActions`). */
  programId?: string
  /**
   * Files dragged onto a folder go into it. Which folder they are over is not here but given to
   * the folder rows, so that dragging across the list renders those rows again, not every cell.
   */
  drop?: Omit<DropTargets, 'over'>
}

/**
 * What the cells do, read from this context: cells live at module level, or `FlexRender` would
 * remount them on every render. The checkboxes read `RowSelectionContext` instead, and each row
 * is a memoized component given whether it is selected, so checking one renders that row again
 * and the checkboxes, not every cell of every row.
 */
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
    onSuccess: (saved) => invalidateFiles(queryClient, saved.course_id),
  })
}

/**
 * SAMPLE (PR 3): what the list will get from the API for a file that follows the LMS. `seen` is
 * false until the file is opened or previewed; `source_name` is the platform's name;
 * `source_updated_at` is when the platform says it last changed.
 */
export type Synced = ItemOut & {
  seen?: boolean
  source_name?: string | null
  source_updated_at?: string | null
}

/** The mark of something not looked at yet: the same dot as an unread announcement. */
export function NewDot({ className }: { className?: string }) {
  return (
    <span className={cn('size-2 shrink-0 rounded-full bg-primary', className)}>
      <span className="sr-only">{m.files_new()}</span>
    </span>
  )
}

function NameCell({ row }: CellProps) {
  const { open } = useHandlers()
  const item = row.original as Synced
  const fresh = item.seen === false
  return (
    <button
      type="button"
      onClick={() => open(item)}
      className="relative flex max-w-full items-center gap-2.5 text-left hover:underline"
    >
      <FileIcon item={item} aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className={cn('truncate', fresh && 'font-medium')}>{item.display_name}</span>
      {/* After the name, so nothing in the row moves when the dot goes. */}
      {fresh ? <NewDot /> : null}
    </button>
  )
}

function SelectBox({ target, className }: { target: Target; className?: string }) {
  const name = target.type === 'item' ? target.item.display_name : target.folder.name
  return (
    <SelectCheckbox
      ids={[targetKey(target)]}
      label={m.files_select({ name })}
      className={className}
    />
  )
}

function SelectCell({ row }: CellProps) {
  return <SelectBox target={{ type: 'item', item: row.original }} />
}

function SelectAllHeader() {
  return <SelectAllCheckbox label={m.files_select_all()} />
}

function SizeCell({ row }: CellProps) {
  return row.original.kind === 'link' ? (
    <span className="text-muted-foreground">—</span>
  ) : (
    <span className="tabular-nums">{formatBytes(row.original.size_bytes)}</span>
  )
}

const changedAt = (item: ItemOut) => (item as Synced).source_updated_at ?? item.updated_at

function UpdatedCell({ row }: CellProps) {
  return formatDateTime(changedAt(row.original))
}

/**
 * Where a file that follows the LMS is kept: read from the platform when opened, or stored here.
 * The user's own files show nothing.
 */
function Origin({ item }: { item: Synced }) {
  if (!item.follows_source || !item.source_name) return null
  const Icon = item.stored ? HardDrive : Cloud
  const kept = item.stored ? m.files_origin_stored() : m.files_origin_online()
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
          <Icon aria-hidden className="size-3.5" />
          <span className="sr-only">{kept}</span>
        </TooltipTrigger>
        <TooltipContent>{kept}</TooltipContent>
      </Tooltip>
      <span className="truncate">{item.source_name}</span>
    </span>
  )
}

function StatusColumnCell({ row }: CellProps) {
  const item = row.original
  // While the pipeline has something to say it takes the cell; otherwise where the file is kept.
  const quiet =
    item.doc_status === 'unsupported' ||
    (item.doc_status === 'ready' && item.ocr_skipped_pages === 0)
  // A fixed height, so a row does not grow or shrink as its file moves through the pipeline.
  return (
    <div className="flex h-8 items-center">
      {quiet ? <Origin item={item} /> : <StatusCell item={item} />}
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
  return <PinButton item={row.original} />
}

export function ItemMenu({ item }: { item: ItemOut }) {
  const { act, programId } = useHandlers()
  const actions = useItemActions(item)
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
        className={
          item.follows_source || (programId && actions.some((a) => a.description))
            ? 'w-72'
            : undefined
        }
      >
        <DropdownMenuItem onClick={() => act({ kind: 'rename', target: { type: 'item', item } })}>
          <Pencil aria-hidden />
          {m.files_rename()}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => act({ kind: 'move', targets: [{ type: 'item', item }] })}>
          <FolderInput aria-hidden />
          {m.files_move_to()}
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
        {item.follows_source ? <KeepItems item={item} /> : null}
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
                  <span className="block">
                    <action.Label programId={programId} item={item} />
                  </span>
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
          onClick={() => act({ kind: 'delete', targets: [{ type: 'item', item }] })}
        >
          <Trash2 aria-hidden />
          {m.common_delete()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * SAMPLE (PR 3): a file that follows the LMS is read from it when opened or stored here; either
 * way it keeps following. "Make it mine" is the one way to stop that.
 */
function KeepItems({ item }: { item: ItemOut }) {
  const queryClient = useQueryClient()
  const keep = useMutation({
    ...filesItemKeepOfflineMutation(),
    onError: toastError,
    onSuccess: (saved) => invalidateFiles(queryClient, saved.course_id),
  })
  const source = (item as Synced).source_name ?? ''
  return (
    <>
      <DropdownMenuSeparator />
      {item.stored ? (
        <DropdownMenuItem>
          <Cloud aria-hidden />
          {m.files_read_online()}
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem onClick={() => keep.mutate({ path: { item_id: item.id } })}>
          <HardDriveDownload aria-hidden />
          {m.files_store_here()}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem>
        <FileOutput aria-hidden />
        <span className="min-w-0">
          <span className="block">{m.files_make_mine()}</span>
          <span className="block text-xs text-muted-foreground">
            {m.files_make_mine_hint({ source })}
          </span>
        </span>
      </DropdownMenuItem>
    </>
  )
}

function ReprocessItem({ item }: { item: ItemOut }) {
  const queryClient = useQueryClient()
  // The menu closes on click, so the mutation lives in the item and reports through toasts.
  const reprocess = useMutation({
    ...filesItemReprocessMutation(),
    onError: toastError,
    onSuccess: (saved) => invalidateFiles(queryClient, saved.course_id),
  })
  return (
    <DropdownMenuItem onClick={() => reprocess.mutate({ path: { item_id: item.id } })}>
      {item.doc_status === 'none' ? <FileSearch aria-hidden /> : <RotateCw aria-hidden />}
      {item.doc_status === 'none' ? m.files_index_now() : m.files_reprocess()}
    </DropdownMenuItem>
  )
}

function ActionsCell({ row }: CellProps) {
  return <ItemMenu item={row.original} />
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
        <DropdownMenuItem
          onClick={() => act({ kind: 'move', targets: [{ type: 'folder', folder }] })}
        >
          <FolderInput aria-hidden />
          {m.files_move_to()}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => act({ kind: 'delete', targets: [{ type: 'folder', folder }] })}
        >
          <Trash2 aria-hidden />
          {m.common_delete()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const columns = column.columns([
  column.display({
    id: 'select',
    header: SelectAllHeader,
    cell: SelectCell,
    enableSorting: false,
  }),
  column.accessor((i) => i.display_name, {
    id: 'name',
    header: () => m.files_name(),
    sortFn: (a, b) => compareNames(a.original.display_name, b.original.display_name),
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
    sortFn: (a, b) => compareNames(changedAt(a.original), changedAt(b.original)),
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
const SELECT_COLUMN = 'w-10 pr-0 pl-4'
const WIDTHS: Record<string, string> = {
  select: SELECT_COLUMN,
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

/** List or grid, remembered for every files page (`files.view`). */
export function ViewToggle() {
  const [view, setView] = useUiPref<'list' | 'grid'>('files.view', 'list')
  return (
    <ToggleGroup
      aria-label={m.files_view()}
      size="sm"
      className={SEGMENTED}
      value={[view]}
      onValueChange={(next) => {
        if (next[0]) setView(next[0] as 'list' | 'grid')
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
  )
}

/** Drag-and-drop for a folder: it can be picked up, and takes files (uploads) and entries. */
function useFolderDnd(folder: FolderOut, dropOver: boolean) {
  const { drop } = useHandlers()
  const target: Target = { type: 'folder', folder }
  const source = useDragSource(target)
  const into = useDropFolder(folder.id, folder.name, 'row')
  return {
    props: {
      ...dropTargetProps(folder.id, drop && { ...drop, over: dropOver ? folder.id : null }),
      ...source.listeners,
      ref: (node: HTMLElement | null) => {
        source.attach(node)
        into.attach(node)
      },
      'data-drop-target': dropOver || into.over ? '' : undefined,
    },
    moving: source.moving,
  }
}

type TileProps = {
  selected: boolean
  /** Something is selected: every checkbox shows, not only on hover. */
  selecting: boolean
}

const FolderTile = memo(function FolderTile({
  folder,
  selected,
  selecting,
  dropOver,
}: TileProps & { folder: FolderOut; dropOver: boolean }) {
  const { openFolder } = useHandlers()
  const dnd = useFolderDnd(folder, dropOver)
  const target: Target = { type: 'folder', folder }
  return (
    <div
      {...dnd.props}
      className={cn(
        'group relative flex h-14 items-center gap-2.5 rounded-xl border bg-card px-3 transition-[background-color,border-color,opacity] hover:bg-muted/50',
        selected && 'border-primary bg-primary/5',
        dnd.moving && 'opacity-50',
        DROP_TARGET,
        'data-drop-target:border-primary',
      )}
    >
      {/* The checkbox takes the icon's place on hover or while selecting. */}
      <div className="relative z-10 grid size-4 shrink-0 place-items-center">
        <Folder
          aria-hidden
          className={cn(
            'size-4 text-muted-foreground transition-opacity',
            (selecting || selected) && 'opacity-0',
            'group-focus-within:opacity-0 group-hover:opacity-0',
          )}
        />
        <SelectBox
          target={target}
          className={cn(
            'absolute inset-0 transition-opacity',
            !(selecting || selected) &&
              'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
          )}
        />
      </div>
      <button
        type="button"
        onClick={() => openFolder(folder.id)}
        className="flex min-w-0 flex-1 items-center text-left text-sm after:absolute after:inset-0"
      >
        <span className="truncate font-medium">{folder.name}</span>
      </button>
      <div className="relative">
        <FolderMenu folder={folder} />
      </div>
    </div>
  )
})

const ItemTile = memo(function ItemTile({
  item,
  selected,
  selecting,
}: TileProps & { item: ItemOut }) {
  const { open } = useHandlers()
  const target: Target = { type: 'item', item }
  const { attach, listeners, moving } = useDragSource(target)
  const [broken, setBroken] = useState(false)
  // Page images are only made for PDFs and images; anything else gets its icon.
  const kind = previewKind(item)
  const thumbnail =
    !broken &&
    (kind === 'pdf' || kind === 'image') &&
    item.doc_status === 'ready' &&
    (item.page_count ?? 0) > 0
  return (
    <div
      ref={attach}
      {...listeners}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-xl border bg-card transition-[border-color,box-shadow,opacity]',
        selected && 'border-primary ring-1 ring-primary',
        moving && 'opacity-50',
      )}
    >
      <SelectBox
        target={target}
        className={cn(
          'absolute top-2.5 left-2.5 z-10 bg-background shadow-sm transition-opacity',
          !(selecting || selected) &&
            'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
        )}
      />
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted/50">
        {thumbnail ? (
          <img
            src={pageImageUrl(item.id, 1)}
            alt=""
            loading="lazy"
            draggable={false}
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
          <PinButton item={item} />
          <ItemMenu item={item} />
        </div>
      </div>
    </div>
  )
})

const FileRow = memo(function FileRow({
  row,
  selected,
  measure,
  index,
}: {
  row: Row<typeof features, ItemOut>
  selected: boolean
  measure?: (node: Element | null) => void
  index?: number
}) {
  const target: Target = { type: 'item', item: row.original }
  const source = useDragSource(target)
  return (
    <TableRow
      ref={(node) => {
        measure?.(node)
        source.attach(node)
      }}
      {...source.listeners}
      data-index={index}
      data-state={selected ? 'selected' : undefined}
      className={cn('transition-[background-color,opacity]', source.moving && 'opacity-50')}
    >
      {row.getAllCells().map((cell) => (
        <TableCell key={cell.id} className={cn('py-2', WIDTHS[cell.column.id])}>
          <FlexRender cell={cell} />
        </TableCell>
      ))}
    </TableRow>
  )
})

const FolderRow = memo(function FolderRow({
  folder,
  selected,
  dropOver,
  fresh,
}: {
  folder: FolderOut
  selected: boolean
  dropOver: boolean
  /** Something in it has not been looked at. */
  fresh: boolean
}) {
  const { openFolder } = useHandlers()
  const dnd = useFolderDnd(folder, dropOver)
  const target: Target = { type: 'folder', folder }
  return (
    <TableRow
      {...dnd.props}
      data-state={selected ? 'selected' : undefined}
      className={cn(
        'transition-[background-color,opacity]',
        dnd.moving && 'opacity-50',
        DROP_TARGET,
      )}
    >
      <TableCell className={cn('py-2', SELECT_COLUMN)}>
        <SelectBox target={target} />
      </TableCell>
      <TableCell className="py-2" colSpan={columnCount - 2}>
        <button
          type="button"
          onClick={() => openFolder(folder.id)}
          className="relative flex max-w-full items-center gap-2.5 font-medium hover:underline"
        >
          <Folder aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{folder.name}</span>
          {fresh ? <NewDot /> : null}
        </button>
      </TableCell>
      <TableCell className={cn('py-2', ICON_COLUMN)}>
        <FolderMenu folder={folder} />
      </TableCell>
    </TableRow>
  )
})

/** Lists this long render only the rows near the screen (LMS syncs bring hundreds of files). */
const VIRTUAL_FROM = 100

/**
 * The folders and files in one folder of a course (`folderId` null: its top level), as a sortable
 * table or a grid of tiles (M07 §6.1). Folders always come first, by name; the chosen sort applies
 * to files.
 *
 * It picks the folder's entries from the course's whole list itself: they then stay the same
 * arrays from one render to the next, and so do the table's rows, which lets a row skip
 * rendering when only another row's checkbox or drop state changed. Filtered by the page, they
 * would be new each time (the page hands them on to its selection hook, so the compiler cannot
 * keep them).
 */
export function FileBrowser({
  list,
  folderId,
  view,
  handlers,
  dropOver,
}: {
  list: FilesItemList
  folderId: string | null
  view: 'list' | 'grid'
  handlers: BrowserHandlers
  /** The folder files are dragged over. */
  dropOver?: string | null
}) {
  const folders = list.folders
    .filter((f) => f.parent_id === folderId)
    .toSorted((a, b) => compareNames(a.name, b.name))
  const items = list.items.filter((i) => i.folder_id === folderId)
  // Folders with something new in them, at any depth.
  const parents = new Map(list.folders.map((f) => [f.id, f.parent_id]))
  const fresh = new Set<string>()
  for (const item of list.items) {
    if ((item as Synced).seen !== false) continue
    for (let id = item.folder_id; id && !fresh.has(id); id = parents.get(id) ?? null) fresh.add(id)
  }
  return (
    <BrowserContext value={handlers}>
      <Entries
        folders={folders}
        items={items}
        view={view}
        dropOver={dropOver ?? null}
        fresh={fresh}
      />
    </BrowserContext>
  )
}

function Entries({
  folders: sortedFolders,
  items,
  view,
  dropOver,
  fresh,
}: {
  folders: readonly FolderOut[]
  items: readonly ItemOut[]
  view: 'list' | 'grid'
  dropOver: string | null
  fresh: ReadonlySet<string>
}) {
  // The page provides the selection: its toolbar acts on it too.
  const selection = use(RowSelectionContext)
  if (!selection) throw new Error('FileBrowser renders inside RowSelectionContext')
  const selected = (target: Target) => selection.has(targetKey(target))
  const selecting = selection.ids.length > 0
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
  // Pinned files stay on top whatever the sort.
  const rows = table
    .getRowModel()
    .rows.toSorted((a, b) => Number(b.original.pinned) - Number(a.original.pinned))

  if (view === 'grid') {
    return (
      <div className="space-y-3">
        {sortedFolders.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3">
            {sortedFolders.map((folder) => (
              <FolderTile
                key={folder.id}
                folder={folder}
                selected={selected({ type: 'folder', folder })}
                selecting={selecting}
                dropOver={dropOver === folder.id}
              />
            ))}
          </div>
        ) : null}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3">
          {rows.map((row) => (
            <ItemTile
              key={row.id}
              item={row.original}
              selected={selected({ type: 'item', item: row.original })}
              selecting={selecting}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <>
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
              <FolderRow
                key={folder.id}
                folder={folder}
                selected={selected({ type: 'folder', folder })}
                dropOver={dropOver === folder.id}
                fresh={fresh.has(folder.id)}
              />
            ))}
            {rows.length < VIRTUAL_FROM
              ? rows.map((row) => (
                  <FileRow
                    key={row.id}
                    row={row}
                    selected={selected({ type: 'item', item: row.original })}
                  />
                ))
              : null}
          </TableBody>
          {rows.length >= VIRTUAL_FROM ? (
            <VirtualBody
              count={rows.length}
              scrollerOf={wrapper}
              renderRow={(index, measure) => {
                const row = rows[index]
                return row ? (
                  <FileRow
                    key={row.id}
                    row={row}
                    selected={selected({ type: 'item', item: row.original })}
                    measure={measure}
                    index={index}
                  />
                ) : null
              }}
            />
          ) : null}
        </Table>
      </div>
    </>
  )
}
