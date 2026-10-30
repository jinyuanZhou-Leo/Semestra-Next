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
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  GripVertical,
  List,
  MoreHorizontal,
  Plus,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import type { SidebarNavProps } from '@/app/extensions'
import { SUB_ACTION } from '@/app/host/sidebar-classes'
import { useUiPref } from '@/app/ui-pref'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { courseColor, courseLabel } from '@/modules/academics/color'
import { useCourses, useTerms } from '@/modules/academics/queries'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
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
import { Field, FieldLabel } from '@/ui/field'
import {
  SidebarMenuAction,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { type TaskActions, useTaskActions } from '../actions'
import { useTaskCounts, useTaskLists } from '../queries'
import {
  INBOX,
  type ListGroup,
  type Selection,
  SMART_VIEWS,
  groupLists,
  parseSelection,
  selectionKey,
} from '../types'
import { ListDialog } from './ListDialog'

/** Which list a tasks page shows, remembered per Program, term or course, shared with the sidebar. */
export function useTaskSelection(scopeId: string) {
  const [pref, setPref] = useUiPref('tasks.selection', 'all', { scope: scopeId })
  const selection = parseSelection(pref)
  return [selection, (next: Selection) => setPref(selectionKey(next))] as const
}

/**
 * The list groups a page shows: on a term's page its own lists and the Program-wide ones; on the
 * Program's page every term's, under the term's name.
 */
function useListGroups(
  programId: string,
  termId: string | undefined,
  lists: readonly TaskList[],
): { groups: ListGroup[]; label: (group: ListGroup) => string | undefined } {
  const terms = useTerms(programId).data?.items ?? []
  // A term not loaded yet still gets its group (unlabelled until it is), so no list drops out.
  const termIds = termId
    ? [termId]
    : [...new Set([...terms.map((t) => t.id), ...lists.flatMap((l) => l.term_id ?? [])])]
  const groups = groupLists(lists, termIds)
  // One group needs no heading.
  const label = (group: ListGroup) =>
    groups.length < 2
      ? undefined
      : group.termId === null
        ? m.tasks_lists_all_terms()
        : terms.find((t) => t.id === group.termId)?.name
  return { groups, label }
}

/** New list, rename and delete, with their dialogs; shared by the sidebar and the page's menu. */
function useListEditing({
  programId,
  termId,
  selection,
  onSelect,
  actions,
}: {
  programId: string
  termId?: string
  selection: Selection
  onSelect: (selection: Selection) => void
  actions: TaskActions
}) {
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<TaskList | null>(null)
  const [deleting, setDeleting] = useState<TaskList | null>(null)
  const [alsoTasks, setAlsoTasks] = useState(false)
  const dialogs = (
    <>
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
    </>
  )
  return {
    create: () => setCreating(true),
    rename: setRenaming,
    remove: (list: TaskList) => {
      setAlsoTasks(false)
      setDeleting(list)
    },
    dialogs,
  }
}

/** Moves one list within its group; the other lists keep their order after it. */
function reorder(
  actions: TaskActions,
  programId: string,
  lists: readonly TaskList[],
  ids: string[],
  from: number,
  to: number,
) {
  const rest = lists.filter((l) => !ids.includes(l.id)).map((l) => l.id)
  void actions.reorderLists(programId, [...arrayMove(ids, from, to), ...rest])
}

function smartCount(counts: TaskCounts | undefined, view: string): number | undefined {
  if (view === 'today') return counts?.today
  if (view === 'scheduled') return counts?.scheduled
  if (view === 'all') return counts?.all
  if (view === 'flagged') return counts?.flagged
  return undefined
}

function SubEntry({
  icon: Icon,
  dot,
  label,
  count,
  active,
  muted,
  hasAction,
  onClick,
}: {
  icon?: LucideIcon
  dot?: string
  label: string
  count?: number
  active?: boolean
  muted?: boolean
  /** The count makes room for the entry's ⋯ button while it shows. */
  hasAction?: boolean
  onClick: () => void
}) {
  return (
    <SidebarMenuSubButton
      isActive={active}
      // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- labelled by its children
      render={<button type="button" />}
      aria-current={active ? 'true' : undefined}
      className={cn('w-full', muted && 'text-muted-foreground')}
      onClick={onClick}
    >
      {Icon ? <Icon aria-hidden className="text-muted-foreground!" /> : null}
      {dot ? (
        <span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
          <span className="size-2 rounded-full" style={{ backgroundColor: dot }} />
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {count ? (
        <span
          className={cn(
            'text-xs text-muted-foreground tabular-nums',
            hasAction &&
              'group-focus-within/menu-sub-item:invisible group-hover/menu-sub-item:invisible',
          )}
        >
          {count}
        </span>
      ) : null}
    </SidebarMenuSubButton>
  )
}

function SidebarListEntry({
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
    listeners: dragListeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: list.id })
  return (
    <SidebarMenuSubItem
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && 'z-10 rounded-xl bg-sidebar shadow-md')}
    >
      <SubEntry
        icon={List}
        label={list.name}
        count={count}
        active={active}
        hasAction
        onClick={onSelect}
      />
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              ref={setActivatorNodeRef}
              type="button"
              aria-label={m.tasks_list_move({ name: list.name })}
              className="absolute top-1 left-2 flex size-5 cursor-grab touch-none items-center justify-center rounded-md bg-sidebar-accent text-muted-foreground opacity-0 outline-hidden group-hover/menu-sub-item:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-sidebar-ring active:cursor-grabbing [&>svg]:size-4"
              {...attributes}
              {...dragListeners}
            />
          }
        >
          <GripVertical aria-hidden />
        </TooltipTrigger>
        <TooltipContent side="right">{m.tasks_drag()}</TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <SidebarMenuAction
              className={SUB_ACTION}
              aria-label={m.tasks_list_menu({ name: list.name })}
            />
          }
        >
          <MoreHorizontal aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start">
          <DropdownMenuItem onClick={onRename}>{m.tasks_list_rename()}</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            {m.common_delete()}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuSubItem>
  )
}

/**
 * The Program's tasks page lists under "Tasks" in the app sidebar (M05 §5.1): smart lists,
 * Unsorted, the user's lists (draggable into a new order) and, folded, the courses.
 */
export function TasksSidebarNav({ scope }: SidebarNavProps) {
  const programId = scope.programId
  const [selection, select] = useTaskSelection(programId)
  const lists = useTaskLists(programId).data?.items ?? []
  const counts = useTaskCounts({ programId }).data
  const courses = useCourses(programId).data?.items ?? []
  const { actions } = useTaskActions()
  const [coursesOpen, setCoursesOpen] = useUiPref('tasks.sidebar_courses_open', false)
  const onSelect = (next: Selection) => {
    select(next)
  }
  const editing = useListEditing({ programId, selection, onSelect, actions })
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const { groups, label } = useListGroups(programId, undefined, lists)
  const active = selectionKey(selection)

  const onDragEnd =
    (ids: string[]) =>
    ({ active: dragged, over }: DragEndEvent) => {
      if (!over || dragged.id === over.id) return
      const from = ids.indexOf(String(dragged.id))
      const to = ids.indexOf(String(over.id))
      if (from >= 0 && to >= 0) reorder(actions, programId, lists, ids, from, to)
    }

  return (
    <SidebarMenuSub aria-label={m.tasks_name()}>
      {SMART_VIEWS.map((v) => (
        <SidebarMenuSubItem key={v.view}>
          <SubEntry
            icon={v.icon}
            label={v.title()}
            count={smartCount(counts, v.view)}
            active={active === v.view}
            onClick={() => onSelect({ kind: 'smart', view: v.view })}
          />
        </SidebarMenuSubItem>
      ))}
      <SidebarMenuSubItem className="mt-2">
        <SubEntry
          icon={INBOX.icon}
          label={INBOX.title()}
          count={counts?.inbox}
          active={active === 'inbox'}
          onClick={() => onSelect({ kind: 'inbox' })}
        />
      </SidebarMenuSubItem>
      {groups.map((group) => {
        const ids = group.lists.map((l) => l.id)
        const heading = label(group)
        return (
          <DndContext
            key={group.termId ?? 'program'}
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd(ids)}
          >
            {heading ? (
              <SidebarMenuSubItem className="mt-2">
                <span className="block truncate px-2 py-1 text-xs text-muted-foreground">
                  {heading}
                </span>
              </SidebarMenuSubItem>
            ) : null}
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              {group.lists.map((list) => (
                <SidebarListEntry
                  key={list.id}
                  list={list}
                  active={active === `list:${list.id}`}
                  count={counts?.lists[list.id] ?? 0}
                  onSelect={() => onSelect({ kind: 'list', listId: list.id })}
                  onRename={() => editing.rename(list)}
                  onDelete={() => editing.remove(list)}
                />
              ))}
            </SortableContext>
          </DndContext>
        )
      })}
      <SidebarMenuSubItem>
        <SubEntry icon={Plus} label={m.tasks_list_new()} muted onClick={editing.create} />
      </SidebarMenuSubItem>
      {courses.length > 0 ? (
        <SidebarMenuSubItem className="mt-2">
          <SidebarMenuSubButton
            size="sm"
            // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- labelled by its children
            render={<button type="button" />}
            aria-expanded={coursesOpen}
            className="w-full font-medium text-muted-foreground"
            onClick={() => setCoursesOpen(!coursesOpen)}
          >
            <ChevronRight
              aria-hidden
              className={cn(
                'text-muted-foreground! transition-transform motion-reduce:transition-none',
                coursesOpen && 'rotate-90',
              )}
            />
            <span>{m.tasks_by_course()}</span>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      ) : null}
      {coursesOpen
        ? courses.map((c) => (
            <SidebarMenuSubItem key={c.id}>
              <SubEntry
                dot={courseColor(c)}
                label={courseLabel(c)}
                count={counts?.courses[c.id]}
                active={active === `course:${c.id}`}
                onClick={() => onSelect({ kind: 'course', courseId: c.id })}
              />
            </SidebarMenuSubItem>
          ))
        : null}
      {editing.dialogs}
    </SidebarMenuSub>
  )
}

function MenuEntry({ lead, label, count }: { lead: ReactNode; label: string; count?: number }) {
  return (
    <>
      {lead}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count ? <span className="text-xs text-muted-foreground tabular-nums">{count}</span> : null}
    </>
  )
}

/**
 * The page title as a menu of the lists, where the app sidebar does not show them (a term's
 * tasks, or the sidebar folded to icons); the list shown also gets rename, move and delete.
 */
export function TasksViewMenu({
  programId,
  termId,
  title,
  selection,
  onSelect,
  counts,
  lists,
  courses,
  actions,
}: {
  programId: string
  termId?: string
  title: string | undefined
  selection: Selection
  onSelect: (selection: Selection) => void
  counts: TaskCounts | undefined
  lists: readonly TaskList[]
  courses: readonly Course[]
  actions: TaskActions
}) {
  const editing = useListEditing({ programId, termId, selection, onSelect, actions })
  const { groups, label } = useListGroups(programId, termId, lists)
  const currentGroup =
    selection.kind === 'list'
      ? groups.find((g) => g.lists.some((l) => l.id === selection.listId))
      : undefined
  // Moving up and down stays within the list's group.
  const ids = currentGroup?.lists.map((l) => l.id) ?? []
  const current = currentGroup?.lists.find(
    (l) => selection.kind === 'list' && l.id === selection.listId,
  )
  const at = current ? ids.indexOf(current.id) : -1

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" className="-ml-2 h-auto min-w-0 gap-1 px-2 py-1" />}
        >
          <h2 className="truncate font-heading text-xl font-semibold tracking-tight">{title}</h2>
          <ChevronDown aria-hidden className="text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuRadioGroup
            value={selectionKey(selection)}
            onValueChange={(value) => onSelect(parseSelection(String(value)))}
          >
            {SMART_VIEWS.map((v) => (
              <DropdownMenuRadioItem key={v.view} value={v.view}>
                <MenuEntry
                  lead={<v.icon aria-hidden />}
                  label={v.title()}
                  count={smartCount(counts, v.view)}
                />
              </DropdownMenuRadioItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuRadioItem value="inbox">
              <MenuEntry
                lead={<INBOX.icon aria-hidden />}
                label={INBOX.title()}
                count={counts?.inbox}
              />
            </DropdownMenuRadioItem>
            {groups.map((group) => {
              const heading = label(group)
              return (
                <DropdownMenuGroup key={group.termId ?? 'program'}>
                  {heading ? <DropdownMenuLabel>{heading}</DropdownMenuLabel> : null}
                  {group.lists.map((list) => (
                    <DropdownMenuRadioItem key={list.id} value={`list:${list.id}`}>
                      <MenuEntry
                        lead={<List aria-hidden />}
                        label={list.name}
                        count={counts?.lists[list.id]}
                      />
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuGroup>
              )
            })}
            {courses.length > 0 ? (
              <DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{m.tasks_by_course()}</DropdownMenuLabel>
                {courses.map((c) => (
                  <DropdownMenuRadioItem key={c.id} value={`course:${c.id}`}>
                    <MenuEntry
                      lead={
                        <span
                          aria-hidden
                          className="flex size-4 shrink-0 items-center justify-center"
                        >
                          <span
                            className="size-2 rounded-full"
                            style={{ backgroundColor: courseColor(c) }}
                          />
                        </span>
                      }
                      label={courseLabel(c)}
                      count={counts?.courses[c.id]}
                    />
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuGroup>
            ) : null}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={editing.create}>
            <Plus aria-hidden />
            {m.tasks_list_new()}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {current ? (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={m.tasks_list_menu({ name: current.name })}
                    />
                  }
                />
              }
            >
              <MoreHorizontal aria-hidden />
            </TooltipTrigger>
            <TooltipContent>{m.tasks_list_menu({ name: current.name })}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => editing.rename(current)}>
              {m.tasks_list_rename()}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={at <= 0}
              onClick={() => reorder(actions, programId, lists, ids, at, at - 1)}
            >
              <ArrowUp aria-hidden />
              {m.tasks_list_move_up()}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={at >= ids.length - 1}
              onClick={() => reorder(actions, programId, lists, ids, at, at + 1)}
            >
              <ArrowDown aria-hidden />
              {m.tasks_list_move_down()}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => editing.remove(current)}>
              {m.common_delete()}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {editing.dialogs}
    </div>
  )
}
