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
import { GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog'
import { Switch } from '@/ui/switch'
import type { PageContribution, Scope } from '../extensions'
import { OVERVIEW_PAGE, useSaveNav, useScopePages } from './nav'

const NOTE = {
  program: m.host_nav_applies_program,
  term: m.host_nav_applies_term,
  course: m.host_nav_applies_course,
} as const

function PageRow({
  page,
  visible,
  onVisibleChange,
}: {
  page: PageContribution
  visible: boolean
  onVisibleChange: (visible: boolean) => void
}) {
  const title = page.title()
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: page.id })
  const locked = page.id === OVERVIEW_PAGE
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'flex items-center gap-2 rounded-lg bg-card px-2 py-1.5',
        isDragging && 'relative z-10 shadow-md ring-1 ring-foreground/10',
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label={m.host_nav_move_page({ page: title })}
        className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical aria-hidden className="size-4" />
      </button>
      <page.icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className={cn('min-w-0 flex-1 truncate text-sm', !visible && 'text-muted-foreground')}>
        {title}
      </span>
      <Switch
        checked={visible}
        disabled={locked}
        aria-label={m.host_nav_show_page({ page: title })}
        title={locked ? m.host_nav_overview_locked() : undefined}
        onCheckedChange={onVisibleChange}
      />
    </li>
  )
}

/**
 * "Manage pages" (M10 §5.1): drag to reorder the tabs, switch pages off to hide them. Saved for
 * the scope type, so every term (or every course) shares one order. Changes apply at once.
 */
export function ManagePagesDialog({
  scope,
  open,
  onOpenChange,
}: {
  scope: Scope
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { all, hidden } = useScopePages(scope)
  const save = useSaveNav(scope.kind)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const ids = all.map((p) => p.id)
  const hiddenIds = ids.filter((id) => hidden.has(id))

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const order = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)))
    void save({ order, hidden: hiddenIds })
  }
  const setVisible = (id: string, visible: boolean) =>
    void save({
      order: ids,
      hidden: visible ? hiddenIds.filter((h) => h !== id) : [...hiddenIds, id],
    })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{m.host_nav_manage_pages()}</DialogTitle>
          <DialogDescription>{NOTE[scope.kind]()}</DialogDescription>
        </DialogHeader>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="-mx-2 space-y-0.5">
              {all.map((page) => (
                <PageRow
                  key={page.id}
                  page={page}
                  visible={!hidden.has(page.id) || page.id === OVERVIEW_PAGE}
                  onVisibleChange={(visible) => setVisible(page.id, visible)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      </DialogContent>
    </Dialog>
  )
}
