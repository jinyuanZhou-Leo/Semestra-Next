import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
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
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import type { Task } from '@semestra/api-client'
import { ArrowDownUp, ChevronRight, CircleCheck, ListChecks } from 'lucide-react'
import { useRef, useState } from 'react'
import type { PageProps } from '@/app/extensions'
import { useShellSidebarOpen } from '@/app/host/ShellToolbar'
import { useHotkey } from '@/app/hotkeys'
import { useUiPref } from '@/app/ui-pref'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { cn } from '@/lib/utils'
import { useCourses } from '@/modules/academics/queries'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { SEGMENT, SEGMENTED } from '@/lib/segmented'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'
import { useTaskActions } from '../actions'
import { QuickAdd } from '../components/QuickAdd'
import { TaskDetail } from '../components/TaskDetail'
import { type EditFocus, NewTaskRow, SortableTaskRow, TaskRow } from '../components/TaskRow'
import { TasksViewMenu, useTaskSelection } from '../components/TasksSidebar'
import { type ScrollRequest, VirtualTaskList } from '../components/VirtualTaskList'
import { useProgramToday, useTaskCounts, useTaskLists, useTaskSettings, useTasks } from '../queries'
import {
  INBOX,
  SMART_VIEWS,
  type Selection,
  type SortKey,
  SORT_KEYS,
  parseSelection,
  selectionKey,
} from '../types'

const SORT_NAMES: Record<SortKey, () => string> = {
  manual: m.tasks_sort_manual,
  due: m.tasks_sort_due,
  priority: m.tasks_sort_priority,
  created: m.tasks_sort_created,
  title: m.tasks_sort_title,
}

type ViewPref = { sort: SortKey; doneOpen: boolean | null }
const DEFAULT_VIEW_PREF: ViewPref = { sort: 'manual', doneOpen: null }
/** Tasks loaded at a time; "Show more" loads the next as many. */
const PAGE = 500
const DONE_PAGE = 200

/**
 * Tasks of a term, a course or the whole Program (M05 §5.1, §5.2): the add box and the tasks of
 * one list. The Program's lists are under "Tasks" in the app sidebar; elsewhere (and on the icon
 * rail) the title is a menu of them. Titles are edited in place; "Edit details" in a row's ⋯ menu
 * (or Enter on the selected row) opens the side panel. The course page is the same list fixed to
 * the course, with the smart lists as a segmented control.
 */
export default function TasksPage({ scope }: PageProps) {
  const programId = scope.programId
  const termId = scope.kind === 'term' ? scope.termId : undefined
  const courseId = scope.kind === 'course' ? scope.courseId : undefined
  const taskScope = { programId, termId, courseId }
  const scopeId = courseId ?? termId ?? programId
  const [selection, setSelection] = useTaskSelection(scopeId)
  // The Program's lists are under "Tasks" in the app sidebar while it is open wide.
  const listsInSidebar = useShellSidebarOpen() && scope.kind === 'program'
  const key = selectionKey(selection)
  const [viewPref, setViewPref] = useUiPref('tasks.view', DEFAULT_VIEW_PREF, {
    scope: `${scopeId}.${key}`,
  })
  const settings = useTaskSettings(programId)
  const { actions, pending } = useTaskActions()
  const lists = useTaskLists(programId)
  const counts = useTaskCounts(taskScope)
  const courses = useCourses(programId, termId).data?.items ?? []
  const completedView = selection.kind === 'smart' && selection.view === 'completed'
  const doneOpen = viewPref.doneOpen ?? settings.show_completed_in_lists
  // How many rows are loaded; a new selection starts over (see `select`).
  const [openLimit, setOpenLimit] = useState(PAGE)
  const [doneLimit, setDoneLimit] = useState(DONE_PAGE)
  const tasks = useTasks(taskScope, selection, {
    sort: viewPref.sort,
    completed: 'hide',
    limit: completedView ? doneLimit : openLimit,
  })
  // Folded, the finished tasks are only counted: one row is fetched for the total.
  const finished = useTasks(
    taskScope,
    selection,
    { sort: 'created', completed: 'only', limit: doneOpen ? doneLimit : 1 },
    !completedView,
  )
  const today = useProgramToday(programId)
  const listRef = useRef<HTMLElement>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  // The one row open for editing in place; `new` is the empty row at the end of the list.
  const [editing, setEditing] = useState<{ id: string; focus: EditFocus } | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  // Set by the arrow keys only, so a list that changes under the selection does not scroll.
  const [scrollTo, setScrollTo] = useState<ScrollRequest | null>(null)
  const [clearing, setClearing] = useState(false)
  const quickAdd = useRef<HTMLInputElement>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const open = completedView ? [] : (tasks.data?.items ?? [])
  const donePage = completedView ? tasks.data : finished.data
  const done = completedView || doneOpen ? (donePage?.items ?? []) : []
  const doneTotal = donePage?.total ?? 0
  const items = [...open, ...done]
  const selected = items.find((t) => t.id === selectedId) ?? null
  const detail = items.find((t) => t.id === detailId) ?? null
  const sortableRows =
    viewPref.sort === 'manual' && (selection.kind === 'list' || selection.kind === 'inbox')
  const listChoices =
    lists.data?.items.filter((l) => !termId || !l.term_id || l.term_id === termId) ?? []

  const select = (next: Selection) => {
    setSelection(next)
    setOpenLimit(PAGE)
    setDoneLimit(DONE_PAGE)
    setSelectedId(null)
    setDetailId(null)
    setEditing(null)
  }
  const stopEditing = (id: string) => setEditing((current) => (current?.id === id ? null : current))
  // The callbacks are shared by every row, so only the rows whose task, selection or editing
  // changed render again.
  const startEditing = (id: string, focus: EditFocus) => setEditing({ id, focus })
  const editDetails = (id: string) => {
    // The side panel takes over: the open row closes (saving what was typed) first.
    stopEditing(id)
    setSelectedId(id)
    setDetailId(id)
  }
  const hideCourse = Boolean(courseId)
  const rowProps = (task: Task) => ({
    task,
    courses,
    today,
    selected: task.id === selectedId,
    onSelect: setSelectedId,
    editing: editing?.id === task.id ? editing.focus : null,
    onStartEdit: startEditing,
    onStopEdit: stopEditing,
    onEdit: editDetails,
    onDelete: setDeleteId,
    actions,
    hideCourse,
  })
  const step = (delta: number) => {
    const index = open.findIndex((t) => t.id === selectedId)
    const next = open[Math.min(open.length - 1, Math.max(0, index + delta))]
    if (!next) return
    setSelectedId(next.id)
    setScrollTo({ id: next.id })
  }
  // Keys act on the list only when focus is on the page or in the list, not in a dialog or sheet.
  // They are skipped (`ignoreEventWhen`) rather than returned from, so a skipped key keeps its
  // default action, e.g. arrows still scroll and Enter still presses the focused button.
  const outsideList = (event: KeyboardEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return false
    return target !== document.body && !listRef.current?.contains(target)
  }
  // Space and Enter belong to a focused control; they act on the selected task only when nothing
  // in particular has focus.
  const onControl = (event: KeyboardEvent) => event.target !== document.body
  useHotkey('n', () => quickAdd.current?.focus(), { ignoreEventWhen: outsideList })
  useHotkey('down, up', (event) => step(event.key === 'ArrowUp' ? -1 : 1), {
    enabled: open.length > 0,
    ignoreEventWhen: (event) =>
      outsideList(event) || (selectedId === null && event.target === document.body),
  })
  useHotkey(
    'space',
    () => {
      if (selected) void actions.complete(selected.id, selected.completed_at === null)
    },
    { enabled: selected !== null, ignoreEventWhen: onControl },
  )
  useHotkey(
    'enter',
    () => {
      if (selected) setDetailId(selected.id)
    },
    { enabled: selected !== null, ignoreEventWhen: onControl },
  )
  useHotkey(
    'delete, backspace',
    () => {
      if (selected) setDeleteId(selected.id)
    },
    { enabled: selected !== null, ignoreEventWhen: outsideList },
  )

  // Like Reminders, a task added to Today or Scheduled is due today unless the text says when.
  const defaultDue =
    selection.kind === 'smart' && (selection.view === 'today' || selection.view === 'scheduled')
      ? today
      : undefined
  const add = (task: {
    title: string
    due_date?: string
    due_time?: string
    priority?: Task['priority']
  }) =>
    actions.create(programId, {
      ...task,
      course_id: courseId ?? (selection.kind === 'course' ? selection.courseId : undefined),
      term_id: courseId || selection.kind === 'course' ? undefined : termId,
      list_id: selection.kind === 'list' ? selection.listId : undefined,
      flagged: selection.kind === 'smart' && selection.view === 'flagged' ? true : undefined,
    })

  // Only under tasks: an empty list keeps its empty state and the add box above.
  const newRow =
    open.length > 0 ? (
      <NewTaskRow
        open={editing?.id === 'new'}
        onOpenChange={(next) =>
          next ? setEditing({ id: 'new', focus: { field: 'title' } }) : stopEditing('new')
        }
        onAdd={(title) => add({ title, ...(defaultDue ? { due_date: defaultDue } : {}) })}
      />
    ) : null

  const onDragStart = ({ active }: DragStartEvent) => setDraggingId(String(active.id))
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDraggingId(null)
    if (!over || active.id === over.id) return
    const ids = open.map((t) => t.id)
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)))
    const after = next[next.indexOf(String(active.id)) + 1]
    void actions.move(String(active.id), { before_task_id: after ?? null })
  }

  const title =
    selection.kind === 'smart'
      ? SMART_VIEWS.find((v) => v.view === selection.view)?.title()
      : selection.kind === 'inbox'
        ? INBOX.title()
        : selection.kind === 'list'
          ? listChoices.find((l) => l.id === selection.listId)?.name
          : courses.find((c) => c.id === selection.courseId)?.title

  const emptyText =
    selection.kind === 'smart' && selection.view === 'today'
      ? { title: m.tasks_today_empty(), description: m.tasks_empty_description() }
      : selection.kind === 'smart' && selection.view === 'flagged'
        ? { title: m.tasks_empty_flagged(), description: m.tasks_empty_description() }
        : selection.kind === 'smart' && selection.view === 'scheduled'
          ? { title: m.tasks_empty_scheduled(), description: m.tasks_empty_scheduled_description() }
          : { title: m.tasks_empty_title(), description: m.tasks_empty_description() }
  // Only where the finished tasks listed are exactly what would go: not in smart lists that
  // filter by date or flag, and not in Unsorted.
  const canClear = completedView || selection.kind === 'list' || selection.kind === 'course'

  const clearScope = {
    list_id: selection.kind === 'list' ? selection.listId : undefined,
    term_id: termId,
    course_id: courseId ?? (selection.kind === 'course' ? selection.courseId : undefined),
  }

  return (
    <div className="flex flex-col">
      <section ref={listRef} className="flex min-w-0 flex-1 flex-col gap-3" aria-label={title}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-2">
          {courseId ? (
            <ToggleGroup
              size="sm"
              className={SEGMENTED}
              value={[key]}
              onValueChange={(value) => value[0] && select(parseSelection(value[0]))}
            >
              {SMART_VIEWS.map((v) => (
                <ToggleGroupItem key={v.view} value={v.view} className={SEGMENT}>
                  {v.title()}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          ) : listsInSidebar ? (
            <h2 className="font-heading text-xl font-semibold tracking-tight">{title}</h2>
          ) : (
            <TasksViewMenu
              programId={programId}
              termId={termId}
              title={title}
              selection={selection}
              onSelect={select}
              counts={counts.data}
              lists={lists.data?.items ?? []}
              courses={courses}
              actions={actions}
            />
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="sm" disabled={completedView} />}
            >
              <ArrowDownUp aria-hidden />
              {SORT_NAMES[viewPref.sort]()}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                value={viewPref.sort}
                onValueChange={(value) => setViewPref({ ...viewPref, sort: value as SortKey })}
              >
                {SORT_KEYS.map((sort) => (
                  <DropdownMenuRadioItem key={sort} value={sort}>
                    {SORT_NAMES[sort]()}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {completedView ? null : (
          <QuickAdd inputRef={quickAdd} programId={programId} defaultDue={defaultDue} onAdd={add} />
        )}
        <AsyncBoundary query={tasks}>
          {() => (
            <>
              {!completedView && open.length === 0 && doneTotal === 0 ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <ListChecks aria-hidden />
                    </EmptyMedia>
                    <EmptyTitle>{emptyText.title}</EmptyTitle>
                    <EmptyDescription>{emptyText.description}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : null}
              {/* One block, so the section's spacing does not open a gap above the new row. */}
              {open.length > 0 ? (
                <div>
                  {sortableRows ? (
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragStart={onDragStart}
                      onDragEnd={onDragEnd}
                      onDragCancel={() => setDraggingId(null)}
                    >
                      <SortableContext
                        items={open.map((t) => t.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        <VirtualTaskList
                          tasks={open}
                          keepId={draggingId ?? editing?.id}
                          scrollTo={scrollTo}
                          renderRow={(task, row) => (
                            <SortableTaskRow key={task.id} {...rowProps(task)} virtual={row} />
                          )}
                        />
                      </SortableContext>
                    </DndContext>
                  ) : completedView ? null : (
                    <VirtualTaskList
                      tasks={open}
                      keepId={editing?.id}
                      scrollTo={scrollTo}
                      renderRow={(task, row) => (
                        <TaskRow key={task.id} {...rowProps(task)} virtual={row} />
                      )}
                    />
                  )}
                  {completedView || !newRow ? null : <ul>{newRow}</ul>}
                  {tasks.data?.next_cursor ? (
                    <ShowMore onClick={() => setOpenLimit(openLimit + PAGE)} />
                  ) : null}
                </div>
              ) : null}
              {completedView ? (
                <CompletedRows
                  rows={done}
                  rowProps={rowProps}
                  editingId={editing?.id}
                  more={Boolean(donePage?.next_cursor)}
                  onMore={() => setDoneLimit(doneLimit + DONE_PAGE)}
                  onClear={() => setClearing(true)}
                />
              ) : doneTotal === 0 ? null : (
                <Collapsible
                  open={doneOpen}
                  onOpenChange={(next) => setViewPref({ ...viewPref, doneOpen: next })}
                >
                  <div className="flex items-center justify-between px-2">
                    <CollapsibleTrigger
                      render={
                        <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" />
                      }
                    >
                      <ChevronRight
                        aria-hidden
                        className={cn('transition-transform', doneOpen && 'rotate-90')}
                      />
                      {m.tasks_completed_count({ count: doneTotal })}
                    </CollapsibleTrigger>
                    {canClear ? (
                      <Button variant="destructive" size="sm" onClick={() => setClearing(true)}>
                        {m.tasks_clear_completed()}
                      </Button>
                    ) : null}
                  </div>
                  <CollapsibleContent>
                    <VirtualTaskList
                      tasks={done}
                      keepId={editing?.id}
                      renderRow={(task, row) => (
                        <TaskRow key={task.id} {...rowProps(task)} virtual={row} />
                      )}
                    />
                    {donePage?.next_cursor ? (
                      <ShowMore onClick={() => setDoneLimit(doneLimit + DONE_PAGE)} />
                    ) : null}
                  </CollapsibleContent>
                </Collapsible>
              )}
            </>
          )}
        </AsyncBoundary>
      </section>
      {detail ? (
        <TaskDetail
          key={detail.id}
          task={detail}
          lists={listChoices}
          courses={courses}
          actions={actions}
          onClose={() => setDetailId(null)}
        />
      ) : null}
      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(next) => !next && setDeleteId(null)}
        title={m.tasks_delete_title()}
        description={m.tasks_delete_description({
          title: items.find((t) => t.id === deleteId)?.title ?? '',
        })}
        confirmLabel={m.common_delete()}
        onConfirm={() => {
          const id = deleteId
          setDeleteId(null)
          if (id) {
            if (id === selectedId) setSelectedId(null)
            if (id === detailId) setDetailId(null)
            stopEditing(id)
            void actions.remove(id)
          }
        }}
      />
      <ConfirmDialog
        open={clearing}
        onOpenChange={setClearing}
        title={m.tasks_clear_title()}
        description={m.tasks_clear_description({ count: doneTotal })}
        confirmLabel={m.tasks_clear_completed()}
        pending={pending}
        onConfirm={() => {
          void actions.clearCompleted(programId, clearScope).then(() => setClearing(false))
        }}
      />
    </div>
  )
}

/** Loads the next page of a list that has more tasks than are shown. */
function ShowMore({ onClick }: { onClick: () => void }) {
  return (
    <div className="px-2 pt-1">
      <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onClick}>
        {m.tasks_show_more()}
      </Button>
    </div>
  )
}

function CompletedRows({
  rows,
  rowProps,
  editingId,
  more,
  onMore,
  onClear,
}: {
  rows: readonly Task[]
  rowProps: (task: Task) => React.ComponentProps<typeof TaskRow>
  editingId: string | undefined
  /** More finished tasks than are loaded. */
  more: boolean
  onMore: () => void
  onClear: () => void
}) {
  if (rows.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CircleCheck aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{m.tasks_completed_empty()}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <>
      <VirtualTaskList
        tasks={rows}
        keepId={editingId}
        renderRow={(task, row) => <TaskRow key={task.id} {...rowProps(task)} virtual={row} />}
      />
      {more ? <ShowMore onClick={onMore} /> : null}
      <div className="px-2">
        <Button variant="destructive" size="sm" onClick={onClear}>
          {m.tasks_clear_completed()}
        </Button>
      </div>
    </>
  )
}
