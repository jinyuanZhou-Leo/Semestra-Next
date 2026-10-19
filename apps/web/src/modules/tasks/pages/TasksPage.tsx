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
import type { Course, Task } from '@semestra/api-client'
import { ArrowDownUp, ChevronRight, CircleCheck, ListChecks } from 'lucide-react'
import { useRef, useState } from 'react'
import type { PageProps } from '@/app/extensions'
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
import { TasksSidebar } from '../components/TasksSidebar'
import { useTaskCounts, useTaskLists, useTaskSettings, useTasks } from '../queries'
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

function localToday(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * Tasks of a term, a course or the whole Program (M05 §5.1, §5.2): smart lists and lists on the
 * left, the tasks in the middle, the selected task's details on the right. The course page is
 * the same list fixed to the course.
 */
export default function TasksPage({ scope }: PageProps) {
  const programId = scope.programId
  const termId = scope.kind === 'term' ? scope.termId : undefined
  const courseId = scope.kind === 'course' ? scope.courseId : undefined
  const taskScope = { programId, termId, courseId }
  const scopeId = courseId ?? termId ?? programId
  const [selectionPref, setSelectionPref] = useUiPref('tasks.selection', 'all', { scope: scopeId })
  const selection = parseSelection(selectionPref)
  const key = selectionKey(selection)
  const [viewPref, setViewPref] = useUiPref('tasks.view', DEFAULT_VIEW_PREF, {
    scope: `${scopeId}.${key}`,
  })
  const settings = useTaskSettings(programId)
  const actions = useTaskActions()
  const lists = useTaskLists(programId)
  const counts = useTaskCounts(taskScope)
  const courses = useCourses(programId, termId).data?.items ?? []
  const tasks = useTasks(taskScope, selection, {
    sort: viewPref.sort,
    includeCompleted: !(selection.kind === 'smart' && selection.view === 'completed'),
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
  const quickAdd = useRef<HTMLInputElement>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const completedView = selection.kind === 'smart' && selection.view === 'completed'
  const items = tasks.data?.items ?? []
  const open = items.filter((t) => t.completed_at === null)
  const done = completedView ? items : items.filter((t) => t.completed_at !== null)
  const doneOpen = viewPref.doneOpen ?? settings.show_completed_in_lists
  const selected = items.find((t) => t.id === selectedId) ?? null
  const sortableRows =
    viewPref.sort === 'manual' && (selection.kind === 'list' || selection.kind === 'inbox')
  const listChoices =
    lists.data?.items.filter((l) => !termId || !l.term_id || l.term_id === termId) ?? []

  const select = (next: Selection) => {
    setSelectionPref(selectionKey(next))
    setSelectedId(null)
  }
  const step = (delta: number) => {
    const index = open.findIndex((t) => t.id === selectedId)
    const next = open[Math.min(open.length - 1, Math.max(0, index + delta))]
    if (next) setSelectedId(next.id)
  }
  useHotkey('n', (event) => {
    event.preventDefault()
    quickAdd.current?.focus()
  })
  useHotkey('down', (event) => {
    event.preventDefault()
    step(1)
  })
  useHotkey('up', (event) => {
    event.preventDefault()
    step(-1)
  })
  useHotkey(
    'space',
    (event) => {
      if (!selected) return
      event.preventDefault()
      void actions.complete(selected.id, selected.completed_at === null)
    },
    { enabled: selected !== null },
  )
  useHotkey('delete, backspace', () => selected && setDeleteId(selected.id), {
    enabled: selected !== null,
  })

  const defaultDue =
    selection.kind === 'smart' && selection.view === 'today' ? localToday() : undefined
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

  const clearScope = {
    list_id: selection.kind === 'list' ? selection.listId : undefined,
    term_id: termId,
    course_id: courseId ?? (selection.kind === 'course' ? selection.courseId : undefined),
  }

  return (
    <div
      className={cn(
        'grid gap-6',
        courseId ? '' : 'md:grid-cols-[13rem_minmax(0,1fr)]',
        selected &&
          (courseId
            ? 'xl:grid-cols-[minmax(0,1fr)_20rem]'
            : 'xl:grid-cols-[13rem_minmax(0,1fr)_20rem]'),
      )}
    >
      {courseId ? null : (
        <TasksSidebar
          programId={programId}
          termId={termId}
          selection={selection}
          onSelect={select}
          counts={counts.data}
          lists={lists.data?.items ?? []}
          courses={courses}
          actions={actions}
        />
      )}
      <section className="min-w-0 space-y-3" aria-label={title}>
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
          ) : (
            <h2 className="font-heading text-2xl font-semibold tracking-tight">{title}</h2>
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
        <AsyncBoundary query={tasks}>
          {() => (
            <>
              {open.length === 0 && done.length === 0 ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <ListChecks aria-hidden />
                    </EmptyMedia>
                    <EmptyTitle>{m.tasks_empty_title()}</EmptyTitle>
                    <EmptyDescription>{m.tasks_empty_description()}</EmptyDescription>
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
                        <SortableTaskRow
                          key={task.id}
                          task={task}
                          courses={courses}
                          selected={task.id === selectedId}
                          onSelect={() => setSelectedId(task.id)}
                          actions={actions}
                          hideCourse={Boolean(courseId)}
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
              ) : (
                <ul>
                  {(completedView ? [] : open).map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      courses={courses}
                      selected={task.id === selectedId}
                      onSelect={() => setSelectedId(task.id)}
                      actions={actions}
                      hideCourse={Boolean(courseId)}
                    />
                  ))}
                </ul>
              )}
              {completedView ? (
                <CompletedRows
                  rows={done}
                  courses={courses}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  actions={actions}
                  courseId={courseId}
                  onClear={() => setClearing(true)}
                />
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
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setClearing(true)}
                    >
                      {m.tasks_clear_completed()}
                    </Button>
                  </div>
                  <CollapsibleContent>
                    <ul>
                      {done.map((task) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          courses={courses}
                          selected={task.id === selectedId}
                          onSelect={() => setSelectedId(task.id)}
                          actions={actions}
                          hideCourse={Boolean(courseId)}
                        />
                      ))}
                    </ul>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </>
          )}
        </AsyncBoundary>
        {completedView ? null : (
          <QuickAdd
            inputRef={quickAdd}
            defaultDue={defaultDue}
            disabled={actions.pending}
            onAdd={add}
          />
        )}
      </section>
      {selected ? (
        <TaskDetail
          key={selected.id}
          task={selected}
          lists={listChoices}
          courses={courses}
          actions={actions}
          onClose={() => setSelectedId(null)}
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
            void actions.remove(id)
          }
        }}
      />
      <ConfirmDialog
        open={clearing}
        onOpenChange={setClearing}
        title={m.tasks_clear_title()}
        description={m.tasks_clear_description()}
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
  courses,
  selectedId,
  onSelect,
  actions,
  courseId,
  onClear,
}: {
  rows: readonly Task[]
  courses: readonly Course[]
  selectedId: string | null
  onSelect: (id: string) => void
  actions: ReturnType<typeof useTaskActions>
  courseId: string | undefined
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
          <TaskRow
            key={task.id}
            task={task}
            courses={courses}
            selected={task.id === selectedId}
            onSelect={() => onSelect(task.id)}
            actions={actions}
            hideCourse={Boolean(courseId)}
          />
        ))}
      </ul>
      <div className="px-2">
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={onClear}
        >
          {m.tasks_clear_completed()}
        </Button>
      </div>
    </>
  )
}
