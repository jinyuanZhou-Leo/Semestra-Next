import type { FolderOut } from '@semestra/api-client'
import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  DragOverlay,
  type Modifier,
  PointerSensor,
  pointerWithin,
  useDndContext,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { getEventCoordinates } from '@dnd-kit/utilities'
import { FolderInput } from 'lucide-react'
import { type ReactNode, createContext, use, useState } from 'react'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { useMoveTargets } from '../actions'
import { type Target, canMoveInto, targetKey, targetName } from '../folders'

type DropData = { folderId: string | null; name: string }

/** The pill sits just below and right of the pointer, whatever was picked up. */
const besidePointer: Modifier = ({ activatorEvent, draggingNodeRect, transform }) => {
  const at = activatorEvent ? getEventCoordinates(activatorEvent) : null
  if (!at || !draggingNodeRect) return transform
  return {
    ...transform,
    x: transform.x + at.x - draggingNodeRect.left + 12,
    y: transform.y + at.y - draggingNodeRect.top + 12,
  }
}

const MODIFIERS = [besidePointer]

/**
 * Files and folders of one course can be dragged onto its folders and breadcrumbs to move
 * them there (M07 §6.1). Dragging a selected entry takes the whole selection with it.
 */
export function FileDragArea({
  folders,
  selected,
  onMoved,
  children,
}: {
  folders: readonly FolderOut[]
  /** The selected entries, in the order shown. */
  selected: readonly Target[]
  onMoved: () => void
  children: ReactNode
}) {
  // A small move first, so a click on a name still opens it.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const move = useMoveTargets()
  const [dragged, setDragged] = useState<Target[]>([])
  const [over, setOver] = useState<DropData | null>(null)

  const start = ({ active }: DragStartEvent) => {
    const target = active.data.current?.target as Target | undefined
    if (!target) return
    const key = targetKey(target)
    setDragged(selected.some((t) => targetKey(t) === key) ? [...selected] : [target])
  }
  const end = ({ over: dropped }: DragEndEvent) => {
    const data = dropped?.data.current as DropData | undefined
    const targets = dragged
    setDragged([])
    setOver(null)
    if (!data || !canMoveInto(targets, data.folderId, folders)) return
    move.mutate({ targets, folderId: data.folderId }, { onSuccess: onMoved, onError: toastError })
  }
  const what =
    dragged.length === 1 && dragged[0]
      ? targetName(dragged[0])
      : m.files_items_count({ count: dragged.length })

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={start}
      onDragOver={({ over: next }: DragOverEvent) =>
        setOver((next?.data.current as DropData | undefined) ?? null)
      }
      onDragEnd={end}
      onDragCancel={() => {
        setDragged([])
        setOver(null)
      }}
    >
      <DraggedContext value={{ dragged, folders }}>{children}</DraggedContext>
      <DragOverlay modifiers={MODIFIERS} dropAnimation={null}>
        {dragged.length > 0 ? (
          <div className="flex w-max max-w-80 items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg">
            <FolderInput aria-hidden className="size-4 shrink-0" />
            <span className="truncate">
              {over ? m.files_move_into({ what, folder: over.name }) : what}
            </span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

const DraggedContext = createContext<{ dragged: Target[]; folders: readonly FolderOut[] }>({
  dragged: [],
  folders: [],
})

/** A file or folder row/tile that can be picked up. */
export function useDragSource(target: Target) {
  const { dragged } = use(DraggedContext)
  const key = targetKey(target)
  const { setNodeRef, listeners } = useDraggable({ id: key, data: { target } })
  return {
    attach: setNodeRef,
    // Only the pointer listeners: the row keeps its own role and focus order.
    listeners,
    moving: dragged.some((t) => targetKey(t) === key),
  }
}

/**
 * A folder row/tile or breadcrumb that takes dragged files. `place` tells apart two targets for
 * the same folder (its row and its crumb). `over` is true while the drag is above it and the
 * move is allowed.
 */
export function useDropFolder(folderId: string | null, name: string, place: string) {
  const { dragged, folders } = use(DraggedContext)
  const { active } = useDndContext()
  const allowed = dragged.length > 0 && canMoveInto(dragged, folderId, folders)
  const { setNodeRef, isOver } = useDroppable({
    id: `${place}:${folderId ?? 'top'}`,
    data: { folderId, name } satisfies DropData,
    disabled: !allowed,
  })
  return { attach: setNodeRef, over: Boolean(active) && isOver && allowed }
}
