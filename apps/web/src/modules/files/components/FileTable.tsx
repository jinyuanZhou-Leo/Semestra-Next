import type { FolderOut, ItemOut } from '@semestra/api-client'
import {
  type CellContext,
  FlexRender,
  type Row,
  type Table as TableInstance,
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, Folder } from 'lucide-react'
import { memo, useRef } from 'react'
import { SelectAllCheckbox } from '@/components/row-selection'
import { formatBytes, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { DROP_TARGET } from '../hooks'
import { type Target, compareNames } from '../folders'
import { NewDot, SelectBox, useFolderDnd, useHandlers } from './browser'
import { useDragSource } from './FileDrag'
import { FileIcon } from './FileIcon'
import { FolderMenu, ItemMenu, PinButton } from './ItemMenus'
import { FolderOrigin, Origin } from './Origin'
import { StatusCell } from './StatusCell'
import { VirtualBody } from './VirtualBody'

export const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() })
const column = createColumnHelper<typeof features, ItemOut>()
type CellProps = CellContext<typeof features, ItemOut>

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
      <span className={cn('truncate', item.unseen && 'font-medium')}>{item.display_name}</span>
      {/* After the name, so nothing in the row moves when the dot goes. */}
      {item.unseen ? <NewDot /> : null}
    </button>
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

function UpdatedCell({ row }: CellProps) {
  return formatDateTime(row.original.modified_at)
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

function PinCell({ row }: CellProps) {
  return <PinButton item={row.original} />
}

function ActionsCell({ row }: CellProps) {
  return <ItemMenu item={row.original} />
}

export const columns = column.columns([
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
  column.accessor((i) => i.modified_at, {
    id: 'updated',
    header: () => m.files_modified(),
    sortFn: (a, b) => compareNames(a.original.modified_at, b.original.modified_at),
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
  /** Something in it, at any depth, has not been opened. */
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
      <TableCell className="py-2" colSpan={columnCount - 4}>
        <button
          type="button"
          onClick={() => openFolder(folder.id)}
          className="flex max-w-full items-center gap-2.5 font-medium hover:underline"
        >
          <Folder aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{folder.name}</span>
          {fresh ? <NewDot /> : null}
        </button>
      </TableCell>
      <TableCell className="py-2">
        <FolderOrigin folder={folder} />
      </TableCell>
      <TableCell className={cn('py-2', ICON_COLUMN)} />
      <TableCell className={cn('py-2', ICON_COLUMN)}>
        <FolderMenu folder={folder} />
      </TableCell>
    </TableRow>
  )
})

/** Lists this long render only the rows near the screen (LMS syncs bring hundreds of files). */
const VIRTUAL_FROM = 100

/**
 * The list view: a sortable table, folders first. `rows` are the table's rows in the order to
 * show; past `VIRTUAL_FROM` only those near the screen render.
 */
export function FileTable({
  table,
  rows,
  folders,
  isSelected,
  dropOver,
  fresh,
}: {
  table: TableInstance<typeof features, ItemOut>
  rows: readonly Row<typeof features, ItemOut>[]
  folders: readonly FolderOut[]
  isSelected: (target: Target) => boolean
  dropOver: string | null
  fresh: ReadonlySet<string>
}) {
  const wrapper = useRef<HTMLDivElement>(null)
  return (
    // The table scrolls sideways inside `Table`'s own container; this only draws the frame.
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
                      sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined
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
          {folders.map((folder) => (
            <FolderRow
              key={folder.id}
              folder={folder}
              selected={isSelected({ type: 'folder', folder })}
              dropOver={dropOver === folder.id}
              fresh={fresh.has(folder.id)}
            />
          ))}
          {rows.length < VIRTUAL_FROM
            ? rows.map((row) => (
                <FileRow
                  key={row.id}
                  row={row}
                  selected={isSelected({ type: 'item', item: row.original })}
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
                  selected={isSelected({ type: 'item', item: row.original })}
                  measure={measure}
                  index={index}
                />
              ) : null
            }}
          />
        ) : null}
      </Table>
    </div>
  )
}
