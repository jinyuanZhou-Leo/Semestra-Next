import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  type ColumnDef,
  type Row,
  type RowData,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, GripVertical, MoreHorizontal } from 'lucide-react'
import { createContext, type ReactNode, use, useState } from 'react'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'

// The list tables of the settings dialog (providers, connections, tokens, sessions, event types,
// subject colors, grade categories) share one look: a rounded, full-width table like a
// `SettingsGroup`, an optional drag handle in front of each row, the row's rare actions in a
// trailing "⋯" menu, and an `ActionRow`-style footer that adds an entry.

/** The features every settings table uses; build columns with `createColumnHelper<typeof …, T>()`. */
export const settingsTableFeatures = tableFeatures({})

type Features = typeof settingsTableFeatures

type Reorder = {
  ids: string[]
  move: (id: string, by: -1 | 1) => void
}

const ReorderContext = createContext<Reorder | null>(null)

type Props<T extends RowData> = {
  /** Names the table for screen readers. */
  label: string
  data: readonly T[]
  // oxlint-disable-next-line typescript/no-explicit-any -- each column has its own value type
  columns: Array<ColumnDef<Features, T, any>>
  getRowId: (row: T) => string
  /** Classes per column id, applied to the header and every cell of that column. */
  columnClassName?: Partial<Record<string, string>>
  /**
   * Makes the rows sortable: a drag handle in front of each row and "Move up / down" in
   * `RowMenu` (through `MoveMenuItems`). Gets the new order of every row id; the table shows
   * that order until the returned promise settles, so a row does not jump back while saving.
   */
  onReorder?: (ids: string[]) => Promise<unknown>
  /** The drag handle's accessible name for a row, e.g. "Move Quizzes". */
  dragLabel?: (row: T) => string
  /** Under the last row, e.g. an `ActionRow` that adds an entry or a short form. */
  footer?: ReactNode
}

/** A settings list as a table (see the comment at the top of this file). */
export function SettingsTable<T extends RowData>({
  label,
  data,
  columns,
  getRowId,
  columnClassName = {},
  onReorder,
  dragLabel,
  footer,
}: Props<T>) {
  const [pending, setPending] = useState<string[] | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const rows = pending
    ? pending.flatMap((id) => data.filter((row) => getRowId(row) === id))
    : [...data]
  const ids = rows.map(getRowId)
  const table = useTable({ features: settingsTableFeatures, columns, data: rows, getRowId })

  const reorder = (next: string[]) => {
    if (!onReorder) return
    setPending(next)
    void onReorder(next).finally(() => setPending(null))
  }
  const move = (id: string, by: -1 | 1) => {
    const from = ids.indexOf(id)
    const to = from + by
    if (from < 0 || to < 0 || to >= ids.length) return
    reorder(arrayMove(ids, from, to))
  }
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    reorder(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))))
  }

  const sortable = onReorder !== undefined
  const body = (
    <TableBody>
      {table.getRowModel().rows.map((row) =>
        sortable ? (
          <SortableRow
            key={row.id}
            row={row}
            dragLabel={dragLabel?.(row.original) ?? m.common_drag_to_reorder()}
            columnClassName={columnClassName}
            table={table}
          />
        ) : (
          <TableRow key={row.id} className="hover:bg-transparent">
            <Cells row={row} columnClassName={columnClassName} table={table} />
          </TableRow>
        ),
      )}
    </TableBody>
  )

  const frame = (
    <div className="w-full overflow-hidden rounded-2xl border">
      <Table aria-label={label}>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {sortable ? (
                <TableHead className="w-8 pr-0 pl-2">
                  <span className="sr-only">{m.common_order()}</span>
                </TableHead>
              ) : null}
              {group.headers.map((header) => (
                <TableHead
                  key={header.id}
                  scope="col"
                  className={cn(
                    'h-9 text-xs font-normal text-muted-foreground first:pl-4 last:pr-3',
                    columnClassName[header.column.id],
                  )}
                >
                  <table.FlexRender header={header} />
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        {sortable ? (
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            {body}
          </SortableContext>
        ) : (
          body
        )}
      </Table>
      {footer ? <div className="border-t">{footer}</div> : null}
    </div>
  )
  if (!sortable) return frame
  return (
    <ReorderContext value={{ ids, move }}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        {frame}
      </DndContext>
    </ReorderContext>
  )
}

type TableInstance<T extends RowData> = ReturnType<typeof useTable<Features, T>>

function Cells<T extends RowData>({
  row,
  table,
  columnClassName,
}: {
  row: Row<Features, T>
  table: TableInstance<T>
  columnClassName: Partial<Record<string, string>>
}) {
  return row.getAllCells().map((cell) => (
    <TableCell
      key={cell.id}
      className={cn('h-14 py-2 first:pl-4 last:pr-3', columnClassName[cell.column.id])}
    >
      <table.FlexRender cell={cell} />
    </TableCell>
  ))
}

function SortableRow<T extends RowData>({
  row,
  table,
  dragLabel,
  columnClassName,
}: {
  row: Row<Features, T>
  table: TableInstance<T>
  dragLabel: string
  columnClassName: Partial<Record<string, string>>
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.id })
  return (
    <TableRow
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'hover:bg-transparent',
        isDragging && 'relative z-10 bg-background shadow-md ring-1 ring-foreground/10',
      )}
    >
      <TableCell className="w-8 pr-0 pl-2">
        <Button
          ref={setActivatorNodeRef}
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={dragLabel}
          className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical aria-hidden />
        </Button>
      </TableCell>
      <Cells row={row} table={table} columnClassName={columnClassName} />
    </TableRow>
  )
}

/**
 * The trailing "⋯" menu of a settings table row. Put destructive items last, after a
 * `DropdownMenuSeparator`, with `variant="destructive"` and a `ConfirmDialog`.
 */
export function RowMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={label}
                    className="text-muted-foreground"
                  />
                }
              />
            }
          >
            <MoreHorizontal aria-hidden />
          </TooltipTrigger>
          <TooltipContent>{m.common_more_actions()}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-44">
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/** "Move up" and "Move down" for a row of a sortable `SettingsTable`, inside its `RowMenu`. */
export function MoveMenuItems({ id }: { id: string }) {
  const reorder = use(ReorderContext)
  if (!reorder) return null
  const index = reorder.ids.indexOf(id)
  return (
    <>
      <DropdownMenuItem disabled={index <= 0} onClick={() => reorder.move(id, -1)}>
        <ArrowUp aria-hidden />
        {m.common_move_up()}
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={index < 0 || index >= reorder.ids.length - 1}
        onClick={() => reorder.move(id, 1)}
      >
        <ArrowDown aria-hidden />
        {m.common_move_down()}
      </DropdownMenuItem>
    </>
  )
}
