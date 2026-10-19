import type { ReactNode } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Course, Task } from '@semestra/api-client'
import { Check, Flag, GripVertical } from 'lucide-react'
import { useState } from 'react'
import { courseColor, courseLabel } from '@/modules/academics/color'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { Input } from '@/ui/input'
import type { TaskActions } from '../actions'
import { dueLabel } from '../due'

const MARKS: Record<Task['priority'], string> = {
  none: '',
  low: '',
  medium: '!',
  high: '!!',
  urgent: '!!!',
}

export function PriorityMark({ priority }: { priority: Task['priority'] }) {
  if (!MARKS[priority]) return null
  return (
    <span
      title={m.tasks_priority_label({ priority: PRIORITY_NAMES[priority]() })}
      className={cn(
        'shrink-0 text-xs font-semibold tabular-nums',
        priority === 'urgent' ? 'text-destructive' : 'text-primary',
      )}
    >
      {MARKS[priority]}
    </span>
  )
}

export const PRIORITY_NAMES: Record<Task['priority'], () => string> = {
  none: m.tasks_priority_none,
  low: m.tasks_priority_low,
  medium: m.tasks_priority_medium,
  high: m.tasks_priority_high,
  urgent: m.tasks_priority_urgent,
}

function InlineTitle({
  title,
  done,
  onSave,
}: {
  title: string
  done: boolean
  onSave: (title: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const finish = (save: boolean) => {
    setEditing(false)
    const next = draft.trim()
    if (save && next && next !== title) onSave(next)
  }
  if (editing) {
    return (
      <Input
        ref={(el) => el?.focus()}
        aria-label={m.tasks_title_label()}
        className="h-7 flex-1 text-base font-medium"
        value={draft}
        maxLength={300}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') finish(true)
          if (event.key === 'Escape') finish(false)
          event.stopPropagation()
        }}
        onClick={(event) => event.stopPropagation()}
      />
    )
  }
  return (
    <button
      type="button"
      className={cn(
        'min-w-0 truncate text-left text-base font-medium outline-none',
        done && 'text-muted-foreground line-through',
      )}
      onDoubleClick={(event) => {
        event.stopPropagation()
        setDraft(title)
        setEditing(true)
      }}
    >
      {title}
    </button>
  )
}

function CourseTag({
  task,
  courses,
  actions,
}: {
  task: Task
  courses: readonly Course[]
  actions: TaskActions
}) {
  const course = courses.find((c) => c.id === task.course_id)
  if (!course) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Badge
            variant="outline"
            render={<button type="button" aria-label={m.tasks_course_label()} />}
            onClick={(event) => event.stopPropagation()}
            className={cn('max-w-40 shrink-0 cursor-pointer border-0 bg-muted/70')}
          />
        }
      >
        {course ? (
          <>
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: courseColor(course) }}
            />
            <span className="truncate">{courseLabel(course)}</span>
          </>
        ) : (
          m.tasks_course_none()
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
        <DropdownMenuItem onClick={() => void actions.update(task.id, { course_id: null })}>
          {m.tasks_course_none()}
          {task.course_id === null ? <Check aria-hidden className="ml-auto" /> : null}
        </DropdownMenuItem>
        {courses.map((c) => (
          <DropdownMenuItem
            key={c.id}
            onClick={() => void actions.update(task.id, { course_id: c.id })}
          >
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: courseColor(c) }}
            />
            <span className="truncate">{courseLabel(c)}</span>
            {task.course_id === c.id ? <Check aria-hidden className="ml-auto" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type Sortable = {
  setNodeRef: (node: HTMLElement | null) => void
  style: React.CSSProperties
  dragging: boolean
  handle: ReactNode
}

type Props = {
  task: Task
  courses: readonly Course[]
  selected: boolean
  onSelect: () => void
  actions: TaskActions
  /** Set while the list can be reordered by dragging. */
  sortable?: Sortable
  /** Hide the course tag when the whole list is one course. */
  hideCourse?: boolean
}

/** One task (M05 §5.1): check, inline-editable title, course tag, due date, priority, flag. */
export function TaskRow({
  task,
  courses,
  selected,
  onSelect,
  actions,
  sortable,
  hideCourse,
}: Props) {
  const done = task.completed_at !== null
  const course = courses.find((c) => c.id === task.course_id)
  const note = task.notes.split('\n')[0]?.trim()
  const hasMeta = Boolean(note) || task.due_date !== null || (course !== undefined && !hideCourse)
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- the row selects; every control in it is a real button
    <li
      ref={sortable?.setNodeRef}
      style={sortable?.style}
      data-selected={selected || undefined}
      data-task-id={task.id}
      onClick={onSelect}
      className={cn(
        'group/row flex items-start gap-3 rounded-2xl px-3 py-2.5 hover:bg-muted/40 data-selected:bg-muted/70',
        sortable?.dragging && 'relative z-10 bg-card shadow-md ring-1 ring-foreground/10',
      )}
    >
      <Checkbox
        checked={done}
        aria-label={m.tasks_complete({ title: task.title })}
        className="mt-0.5 size-5 rounded-full"
        onClick={(event) => event.stopPropagation()}
        onCheckedChange={(checked) => void actions.complete(task.id, checked)}
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <PriorityMark priority={task.priority} />
          <InlineTitle
            title={task.title}
            done={done}
            onSave={(title) => void actions.update(task.id, { title })}
          />
          {task.flagged ? (
            <Flag
              aria-label={m.tasks_unflag()}
              className="size-3.5 shrink-0 fill-current text-primary"
            />
          ) : null}
        </div>
        {hasMeta ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
            {note ? <span className="max-w-full truncate">{note}</span> : null}
            {task.due_date ? (
              <span className={cn('tabular-nums', task.overdue && !done && 'text-destructive')}>
                {dueLabel(task)}
              </span>
            ) : null}
            {hideCourse ? null : <CourseTag task={task} courses={courses} actions={actions} />}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center opacity-0 group-hover/row:opacity-100 focus-within:opacity-100">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={task.flagged ? m.tasks_unflag() : m.tasks_flag()}
          aria-pressed={task.flagged}
          className="text-muted-foreground"
          onClick={(event) => {
            event.stopPropagation()
            void actions.update(task.id, { flagged: !task.flagged })
          }}
        >
          <Flag aria-hidden className={cn(task.flagged && 'fill-current text-primary')} />
        </Button>
        {sortable?.handle}
      </div>
    </li>
  )
}

/** A row that can be dragged to a new place in the list. */
export function SortableTaskRow(props: Omit<Props, 'sortable'>) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.task.id })
  return (
    <TaskRow
      {...props}
      sortable={{
        setNodeRef,
        style: { transform: CSS.Translate.toString(transform), transition },
        dragging: isDragging,
        handle: (
          <Button
            ref={setActivatorNodeRef}
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={m.tasks_move({ title: props.task.title })}
            className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
            onClick={(event) => event.stopPropagation()}
            {...attributes}
            {...listeners}
          >
            <GripVertical aria-hidden />
          </Button>
        ),
      }}
    />
  )
}
