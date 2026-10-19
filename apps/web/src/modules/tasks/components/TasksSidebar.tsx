import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Course, TaskCounts, TaskList } from '@semestra/api-client'
import type { LucideIcon } from 'lucide-react'
import { ChevronRight, GripVertical, List, MoreHorizontal, Plus } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { courseColor, courseLabel } from '@/modules/academics/color'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { Field, FieldLabel } from '@/ui/field'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import type { TaskActions } from '../actions'
import { INBOX, type Selection, SMART_VIEWS, orderLists, selectionKey } from '../types'
import { ListDialog } from './ListDialog'

function NavItem({
  icon: Icon,
  label,
  count,
  active,
  dot,
  onClick,
}: {
  icon?: LucideIcon
  label: string
  count?: number
  active: boolean
  dot?: string
  onClick: () => void
}) {
  return (
    <Button
      variant={active ? 'secondary' : 'ghost'}
      aria-current={active ? 'true' : undefined}
      className="w-full justify-start gap-2 font-normal"
      onClick={onClick}
    >
      {Icon ? <Icon aria-hidden className="text-muted-foreground" /> : null}
      {dot ? (
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: dot }}
        />
      ) : null}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {count ? <span className="text-xs text-muted-foreground tabular-nums">{count}</span> : null}
    </Button>
  )
}

function ListItem({
  list,
  active,
  count,
  onSelect,
  onRename,
  onDelete,
}: {
  list: TaskList
  active: boolean
  count: number
  onSelect: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: list.id })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'group/list relative flex items-center',
        isDragging && 'z-10 rounded-lg bg-card shadow-md',
      )}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              ref={setActivatorNodeRef}
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={m.tasks_list_move({ name: list.name })}
              className="absolute left-0 z-10 cursor-grab touch-none text-muted-foreground opacity-0 group-hover/list:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
              {...attributes}
              {...listeners}
            />
          }
        >
          <GripVertical aria-hidden />
        </TooltipTrigger>
        <TooltipContent>{m.tasks_drag()}</TooltipContent>
      </Tooltip>
      <div className="min-w-0 flex-1">
        <NavItem icon={List} label={list.name} count={count} active={active} onClick={onSelect} />
      </div>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={m.tasks_list_menu({ name: list.name })}
                    className="absolute right-1 opacity-0 group-hover/list:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
                  />
                }
              />
            }
          >
            <MoreHorizontal aria-hidden />
          </TooltipTrigger>
          <TooltipContent>{m.tasks_list_menu({ name: list.name })}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onRename}>{m.tasks_list_rename()}</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            {m.common_delete()}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

/**
 * The left column of the tasks page (M05 §5.1): smart lists, inbox, the user's lists (term lists
 * first) and the term's courses. Lists can be dragged into a new order.
 */
export function TasksSidebar({
  programId,
  termId,
  selection,
  onSelect,
  counts,
  lists,
  courses,
  actions,
}: {
  programId: string
  termId?: string
  selection: Selection
  onSelect: (selection: Selection) => void
  counts: TaskCounts | undefined
  lists: readonly TaskList[]
  courses: readonly Course[]
  actions: TaskActions
}) {
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<TaskList | null>(null)
  const [deleting, setDeleting] = useState<TaskList | null>(null)
  const [alsoTasks, setAlsoTasks] = useState(false)
  const [coursesOpen, setCoursesOpen] = useState(true)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  // A term page shows its own lists and the Program-wide ones; the Program page shows all.
  const visible = orderLists(
    lists.filter((l) => !termId || l.term_id === null || l.term_id === termId),
  )
  const ids = visible.map((l) => l.id)
  const active = selectionKey(selection)
  const countOf: Record<string, number | undefined> = {
    today: counts?.today,
    scheduled: counts?.scheduled,
    all: counts?.all,
    flagged: counts?.flagged,
    completed: counts?.completed,
  }

  const onDragEnd = ({ active: dragged, over }: DragEndEvent) => {
    if (!over || dragged.id === over.id) return
    const from = ids.indexOf(String(dragged.id))
    const to = ids.indexOf(String(over.id))
    // Lists of other terms keep their place after the visible ones.
    const rest = lists.filter((l) => !ids.includes(l.id)).map((l) => l.id)
    void actions.reorderLists(programId, [...arrayMove(ids, from, to), ...rest])
  }

  return (
    <nav aria-label={m.tasks_name()} className="space-y-4">
      <div className="space-y-0.5">
        {SMART_VIEWS.map((v) => (
          <NavItem
            key={v.view}
            icon={v.icon}
            label={v.title()}
            count={v.view === 'completed' ? undefined : countOf[v.view]}
            active={active === v.view}
            onClick={() => onSelect({ kind: 'smart', view: v.view })}
          />
        ))}
      </div>
      <div className="space-y-0.5">
        <NavItem
          icon={INBOX.icon}
          label={INBOX.title()}
          count={counts?.inbox}
          active={active === 'inbox'}
          onClick={() => onSelect({ kind: 'inbox' })}
        />
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="space-y-0.5">
              {visible.map((list) => (
                <ListItem
                  key={list.id}
                  list={list}
                  active={active === `list:${list.id}`}
                  count={counts?.lists[list.id] ?? 0}
                  onSelect={() => onSelect({ kind: 'list', listId: list.id })}
                  onRename={() => setRenaming(list)}
                  onDelete={() => {
                    setAlsoTasks(false)
                    setDeleting(list)
                  }}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 font-normal text-muted-foreground"
          onClick={() => setCreating(true)}
        >
          <Plus aria-hidden />
          {m.tasks_list_new()}
        </Button>
      </div>
      {courses.length > 0 ? (
        <Collapsible open={coursesOpen} onOpenChange={setCoursesOpen}>
          <CollapsibleTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-1 text-xs font-medium text-muted-foreground"
              />
            }
          >
            <ChevronRight
              aria-hidden
              className={cn('transition-transform', coursesOpen && 'rotate-90')}
            />
            {m.tasks_by_course()}
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-0.5">
            {courses.map((c) => (
              <NavItem
                key={c.id}
                label={courseLabel(c)}
                dot={courseColor(c)}
                count={counts?.courses[c.id]}
                active={active === `course:${c.id}`}
                onClick={() => onSelect({ kind: 'course', courseId: c.id })}
              />
            ))}
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      {creating ? (
        <ListDialog
          open
          onOpenChange={setCreating}
          title={m.tasks_list_new()}
          canChooseLevel={Boolean(termId)}
          onSubmit={async ({ name, termLevel }) => {
            const created = await actions.createList(programId, {
              name,
              term_id: termId && termLevel ? termId : null,
            })
            onSelect({ kind: 'list', listId: created.id })
          }}
        />
      ) : null}
      {renaming ? (
        <ListDialog
          open
          onOpenChange={(open) => !open && setRenaming(null)}
          title={m.tasks_list_rename()}
          initialName={renaming.name}
          onSubmit={({ name }) => actions.renameList(renaming.id, name)}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={m.tasks_list_delete_title()}
        description={m.tasks_list_delete_description({ name: deleting?.name ?? '' })}
        extra={
          <Field orientation="horizontal">
            <Checkbox id="also-tasks" checked={alsoTasks} onCheckedChange={setAlsoTasks} />
            <FieldLabel htmlFor="also-tasks">{m.tasks_list_delete_tasks()}</FieldLabel>
          </Field>
        }
        confirmLabel={m.common_delete()}
        onConfirm={() => {
          const list = deleting
          setDeleting(null)
          if (!list) return
          if (selection.kind === 'list' && selection.listId === list.id) {
            onSelect({ kind: 'smart', view: 'all' })
          }
          void actions.deleteList(list.id, alsoTasks)
        }}
      />
    </nav>
  )
}
