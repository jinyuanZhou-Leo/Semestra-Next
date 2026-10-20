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
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'
import { useTaskActions } from '../actions'
import { QuickAdd } from '../components/QuickAdd'
import { TaskDetail } from '../components/TaskDetail'
import { SortableTaskRow, TaskRow } from '../components/TaskRow'
import { TasksViewMenu, useTaskSelection } from '../components/TasksSidebar'
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
  const actions = useTaskActions()
  const lists = useTaskLists(programId)
  const counts = useTaskCounts(taskScope)
  const courses = useCourses(programId, termId).data?.items ?? []
  const completedView = selection.kind === 'smart' && selection.view === 'completed'
  const tasks = useTasks(taskScope, selection, { sort: viewPref.sort, completed: 'hide' })
  const finished = useTasks(
    taskScope,
    selection,
    { sort: 'created', completed: 'only' },
    !completedView,
  )
  const today = useProgramToday(programId)
  const listRef = useRef<HTMLElement>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
  const quickAdd = useRef<HTMLInputElement>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const open = completedView ? [] : (tasks.data?.items ?? [])
  const done = (completedView ? tasks.data?.items : finished.data?.items) ?? []
  const items = [...open, ...done]
  const doneOpen = viewPref.doneOpen ?? settings.show_completed_in_lists
  const selected = items.find((t) => t.id === selectedId) ?? null
  const detail = items.find((t) => t.id === detailId) ?? null
  const sortableRows =
    viewPref.sort === 'manual' && (selection.kind === 'list' || selection.kind === 'inbox')
  const listChoices =
    lists.data?.items.filter((l) => !termId || !l.term_id || l.term_id === termId) ?? []

  const select = (next: Selection) => {
    setSelection(next)
    setSelectedId(null)
    setDetailId(null)
  }
  const rowProps = (task: Task) => ({
    task,
    courses,
    selected: task.id === selectedId,
    onSelect: () => setSelectedId(task.id),
    onEdit: () => {
      setSelectedId(task.id)
      setDetailId(task.id)
    },
    onDelete: () => setDeleteId(task.id),
    actions,
    hideCourse: Boolean(courseId),
  })
  const step = (delta: number) => {
    const index = open.findIndex((t) => t.id === selectedId)
    const next = open[Math.min(open.length - 1, Math.max(0, index + delta))]
    if (next) setSelectedId(next.id)
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

  const defaultDue = selection.kind === 'smart' && selection.view === 'today' ? today : undefined
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

  const onDragEnd = ({ active, over }: DragEndEvent) => {
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
    <div>
      <section ref={listRef} className="min-w-0 space-y-3" aria-label={title}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-2">
          {courseId ? (
            <ToggleGroup
              variant="outline"
              size="sm"
              value={[key]}
              onValueChange={(value) => value[0] && select(parseSelection(value[0]))}
            >
              {SMART_VIEWS.map((v) => (
                <ToggleGroupItem key={v.view} value={v.view}>
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
          <QuickAdd
            inputRef={quickAdd}
            today={today}
            defaultDue={defaultDue}
            disabled={actions.pending}
            onAdd={add}
          />
        )}
        <AsyncBoundary query={tasks}>
          {() => (
            <>
              {!completedView && open.length === 0 && done.length === 0 ? (
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
              {sortableRows ? (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={onDragEnd}
                >
                  <SortableContext
                    items={open.map((t) => t.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <ul>
                      {open.map((task) => (
                        <SortableTaskRow key={task.id} {...rowProps(task)} />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
              ) : (
                <ul>
                  {(completedView ? [] : open).map((task) => (
                    <TaskRow key={task.id} {...rowProps(task)} />
                  ))}
                </ul>
              )}
              {completedView ? (
                <CompletedRows rows={done} rowProps={rowProps} onClear={() => setClearing(true)} />
              ) : completedView || done.length === 0 ? null : (
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
                      {m.tasks_completed_count({ count: done.length })}
                    </CollapsibleTrigger>
                    {canClear ? (
                      <Button variant="destructive" size="sm" onClick={() => setClearing(true)}>
                        {m.tasks_clear_completed()}
                      </Button>
                    ) : null}
                  </div>
                  <CollapsibleContent>
                    <ul>
                      {done.map((task) => (
                        <TaskRow key={task.id} {...rowProps(task)} />
                      ))}
                    </ul>
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
            void actions.remove(id)
          }
        }}
      />
      <ConfirmDialog
        open={clearing}
        onOpenChange={setClearing}
        title={m.tasks_clear_title()}
        description={m.tasks_clear_description({ count: done.length })}
        confirmLabel={m.tasks_clear_completed()}
        pending={actions.pending}
        onConfirm={() => {
          void actions.clearCompleted(programId, clearScope).then(() => setClearing(false))
        }}
      />
    </div>
  )
}

function CompletedRows({
  rows,
  rowProps,
  onClear,
}: {
  rows: readonly Task[]
  rowProps: (task: Task) => React.ComponentProps<typeof TaskRow>
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
      <ul>
        {rows.map((task) => (
          <TaskRow key={task.id} {...rowProps(task)} />
        ))}
      </ul>
      <div className="px-2">
        <Button variant="destructive" size="sm" onClick={onClear}>
          {m.tasks_clear_completed()}
        </Button>
      </div>
    </>
  )
}
