import type { ReactNode, RefObject } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Course, Task, TaskUpdateInputBody } from '@semestra/api-client'
import { Check, Flag, GripVertical, MoreHorizontal, PanelRight, Star, Trash2 } from 'lucide-react'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { courseColor, courseLabel } from '@/modules/academics/color'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import type { TaskActions } from '../actions'
import { dueLabel } from '../due'
import { useProgramToday } from '../queries'
import { PRIORITIES, type ShownPriority, shownPriority } from '../types'
import { PRIORITY_COLORS, PRIORITY_NAMES, PriorityFlag } from './priority'
import { TaskChips } from './TaskChips'

/** Where the cursor goes when a row opens for editing: the field, and the caret in it. */
export type EditFocus = { field: 'title' | 'notes'; caret?: number }

/** Popups opened from a row (menus, the calendar); clicks in them stay "inside" the row. */
const POPUPS =
  '[data-slot="popover-content"],[data-slot="dropdown-menu-content"],[data-slot="dropdown-menu-sub-content"],[data-slot="select-content"]'

/** The text offset under a click, so the field opens with the caret where the user clicked. */
function caretAt(event: React.MouseEvent): number | undefined {
  if (event.detail === 0) return undefined // keyboard: the caret goes to the end
  const pos = document.caretPositionFromPoint?.(event.clientX, event.clientY)
  if (pos) return pos.offset
  // Safari before 26 only has the older API.
  const legacy = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  return legacy.caretRangeFromPoint?.(event.clientX, event.clientY)?.startOffset
}

/** Focuses a field with the caret at `caret` (the end when unset). */
function focusAt(el: HTMLInputElement | HTMLTextAreaElement | null, caret?: number) {
  if (!el) return
  el.focus()
  const at = Math.min(caret ?? el.value.length, el.value.length)
  el.setSelectionRange(at, at)
}

/**
 * The open row (M05 §5.1), like Reminders: the title and notes are edited where they are, the
 * property chips save right away. Enter or a click outside saves and closes; Esc throws away the
 * title and notes changes; a title left empty deletes the task without asking.
 */
function RowEditor({
  task,
  courses,
  hideCourse,
  focus,
  rowRef,
  actions,
  onClose,
}: {
  task: Task
  courses: readonly Course[]
  hideCourse?: boolean
  focus: EditFocus
  rowRef: RefObject<HTMLLIElement | null>
  actions: TaskActions
  onClose: () => void
}) {
  const today = useProgramToday(task.program_id)
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes)
  const closed = useRef(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const notesRef = useRef<HTMLTextAreaElement>(null)
  // As the row opens: the field and caret where the click was.
  useEffect(() => {
    focusAt(focus.field === 'title' ? titleRef.current : notesRef.current, focus.caret)
  }, [focus.field, focus.caret])
  const finish = (save: boolean) => {
    if (closed.current) return
    closed.current = true
    onClose()
    if (!save) return
    const nextTitle = title.trim()
    if (!nextTitle) {
      void actions.remove(task.id)
      return
    }
    const body: TaskUpdateInputBody = {}
    if (nextTitle !== task.title) body.title = nextTitle
    if (notes !== task.notes) body.notes = notes
    if (Object.keys(body).length > 0) void actions.update(task.id, body)
  }
  const leave = useEffectEvent((target: EventTarget | null, row: HTMLElement) => {
    if (target instanceof Node && row.contains(target)) return
    if (target instanceof Element && target.closest(POPUPS)) return
    finish(true)
  })
  useEffect(() => {
    const row = rowRef.current
    if (!row) return
    // Closing on the click, not the press: closing on the press would shift the rows below
    // under the pointer, and the click meant for another row's title would miss it.
    let pressed = false
    let popupWasOpen = false
    const onPointerDown = () => {
      pressed = true
      popupWasOpen = row.querySelector('[aria-expanded="true"]') !== null
    }
    const onPointerUp = () => {
      pressed = false
    }
    const onClick = (event: MouseEvent) => {
      // The first click outside an open menu or calendar only closes that popup.
      if (!popupWasOpen) leave(event.target, row)
      popupWasOpen = false
    }
    // Tabbing away; focus moved by a press is left to the click.
    const onFocusOut = (event: FocusEvent) => {
      if (!pressed && event.relatedTarget) leave(event.relatedTarget, row)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointerup', onPointerUp, true)
    document.addEventListener('click', onClick, true)
    row.addEventListener('focusout', onFocusOut)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointerup', onPointerUp, true)
      document.removeEventListener('click', onClick, true)
      row.removeEventListener('focusout', onFocusOut)
    }
  }, [rowRef])

  const keys = (event: React.KeyboardEvent, enterSaves: boolean) => {
    if (event.nativeEvent.isComposing) return
    const save = event.key === 'Enter' && (enterSaves || event.metaKey || event.ctrlKey)
    if (save || event.key === 'Escape') {
      event.preventDefault()
      finish(save)
    }
  }
  return (
    <>
      <input
        ref={titleRef}
        aria-label={m.tasks_title_label()}
        className="block w-full bg-transparent p-0 text-base font-medium outline-none"
        value={title}
        maxLength={300}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => keys(event, true)}
      />
      <textarea
        ref={notesRef}
        aria-label={m.tasks_notes_label()}
        placeholder={m.tasks_notes_label()}
        rows={Math.min(Math.max(notes.split('\n').length, 1), 8)}
        maxLength={20000}
        className="block w-full resize-none bg-transparent p-0 text-sm text-muted-foreground outline-none placeholder:text-muted-foreground/70"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        onKeyDown={(event) => keys(event, false)}
      />
      <div className="pt-1.5 pb-0.5">
        <TaskChips
          task={task}
          courses={courses}
          today={today}
          hideCourse={hideCourse}
          onChange={(body) => void actions.update(task.id, body)}
        />
      </div>
    </>
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
  /** Set while the row is open for editing in place; only one row is open at a time. */
  editing: EditFocus | null
  onStartEdit: (focus: EditFocus) => void
  onStopEdit: () => void
  /** Opens the task in the side panel. */
  onEdit: () => void
  /** Asks to delete the task. */
  onDelete: () => void
  actions: TaskActions
  /** Set while the list can be reordered by dragging. */
  sortable?: Sortable
  /** Hide the course tag when the whole list is one course. */
  hideCourse?: boolean
}

/**
 * One task (M05 §5.1): check, title, course tag, due date, priority flag and star. A click on the
 * title or the note opens the row in place (`RowEditor`); the ⋯ menu opens the side panel with
 * every field, changes the priority and deletes.
 */
export function TaskRow({
  task,
  courses,
  selected,
  onSelect,
  editing,
  onStartEdit,
  onStopEdit,
  onEdit,
  onDelete,
  actions,
  sortable,
  hideCourse,
}: Props) {
  const today = useProgramToday(task.program_id)
  const rowRef = useRef<HTMLLIElement | null>(null)
  const done = task.completed_at !== null
  const course = courses.find((c) => c.id === task.course_id)
  const note = task.notes.split('\n')[0]?.trim()
  const hasMeta = Boolean(note) || task.due_date !== null || (course !== undefined && !hideCourse)
  const start = (field: EditFocus['field']) => (event: React.MouseEvent) => {
    event.stopPropagation()
    onSelect()
    onStartEdit({ field, caret: caretAt(event) })
  }
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- the row selects; every control in it is a real button
    <li
      ref={(node) => {
        rowRef.current = node
        sortable?.setNodeRef(node)
      }}
      style={sortable?.style}
      data-selected={selected || undefined}
      data-editing={editing ? true : undefined}
      data-task-id={task.id}
      onClick={onSelect}
      className={cn(
        'group/row flex items-start gap-3 rounded-2xl px-3 py-2.5 hover:bg-muted/40 data-selected:bg-muted/70 data-editing:bg-muted/70',
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
        {editing ? (
          <RowEditor
            task={task}
            courses={courses}
            hideCourse={hideCourse}
            focus={editing}
            rowRef={rowRef}
            actions={actions}
            onClose={onStopEdit}
          />
        ) : (
          <>
            <div className="flex min-w-0 items-center gap-1.5">
              <button
                type="button"
                aria-label={m.tasks_edit_title({ title: task.title })}
                className={cn(
                  'min-w-0 cursor-text truncate rounded-sm text-left text-base font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                  done && 'text-muted-foreground line-through',
                )}
                onClick={start('title')}
              >
                {task.title}
              </button>
              <PriorityFlag priority={task.priority} />
              {task.flagged ? (
                <Star
                  aria-label={m.tasks_flagged()}
                  className="size-3.5 shrink-0 fill-current text-primary"
                />
              ) : null}
            </div>
            {hasMeta ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
                {note ? (
                  <button
                    type="button"
                    aria-label={m.tasks_edit_notes({ title: task.title })}
                    className="max-w-full cursor-text truncate rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    onClick={start('notes')}
                  >
                    {note}
                  </button>
                ) : null}
                {task.due_date ? (
                  <span className={cn('tabular-nums', task.overdue && !done && 'text-destructive')}>
                    {dueLabel(task, today)}
                  </span>
                ) : null}
                {hideCourse ? null : <CourseTag task={task} courses={courses} actions={actions} />}
              </div>
            ) : null}
          </>
        )}
      </div>
      {/* Revealed on hover, focus, selection or editing; always shown where there is no hover (touch). */}
      <div className="flex shrink-0 items-center opacity-0 group-hover/row:opacity-100 group-data-selected/row:opacity-100 group-data-editing/row:opacity-100 focus-within:opacity-100 has-aria-expanded:opacity-100 pointer-coarse:opacity-100">
        {/* While open, the flag chip under the title takes its place. */}
        {editing ? null : (
          <Tooltip>
            <TooltipTrigger
              render={
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
                />
              }
            >
              <Star aria-hidden className={cn(task.flagged && 'fill-current text-primary')} />
            </TooltipTrigger>
            <TooltipContent>{task.flagged ? m.tasks_unflag() : m.tasks_flag()}</TooltipContent>
          </Tooltip>
        )}
        <RowMenu task={task} onEdit={onEdit} onDelete={onDelete} actions={actions} />
        {sortable?.handle}
      </div>
    </li>
  )
}

/**
 * The empty circle at the end of a list (M05 §5.1), like Reminders: a click turns it into a title
 * field; Enter adds the task and leaves the field open for the next one, leaving it adds what was
 * typed, Esc drops it.
 */
export function NewTaskRow({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (title: string) => Promise<unknown>
}) {
  const [title, setTitle] = useState('')
  // Esc closes without adding, even if the browser reports a blur as the field goes away.
  const dropped = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (open) focusAt(inputRef.current)
  }, [open])
  const add = () => {
    const next = title.trim()
    setTitle('')
    if (next) void onAdd(next).catch(() => setTitle(next))
  }
  return (
    <li className="flex items-center gap-3 rounded-2xl px-3 py-2.5">
      <span
        aria-hidden
        className="size-5 shrink-0 rounded-full border border-dashed border-muted-foreground/50"
      />
      {open ? (
        <input
          ref={inputRef}
          aria-label={m.tasks_new_row()}
          placeholder={m.tasks_new_row()}
          className="block w-full bg-transparent p-0 text-base font-medium outline-none placeholder:text-muted-foreground"
          value={title}
          maxLength={300}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => {
            if (!dropped.current) add()
            onOpenChange(false)
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter') {
              event.preventDefault()
              add()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              dropped.current = true
              setTitle('')
              onOpenChange(false)
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="flex-1 cursor-text text-left text-base font-medium text-transparent outline-none hover:text-muted-foreground focus-visible:text-muted-foreground"
          onClick={() => {
            dropped.current = false
            onOpenChange(true)
          }}
        >
          {m.tasks_new_row()}
        </button>
      )}
    </li>
  )
}

function RowMenu({
  task,
  onEdit,
  onDelete,
  actions,
}: {
  task: Task
  onEdit: () => void
  onDelete: () => void
  actions: TaskActions
}) {
  const label = m.tasks_row_menu({ title: task.title })
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={label}
                  className="text-muted-foreground"
                  onClick={(event) => event.stopPropagation()}
                />
              }
            />
          }
        >
          <MoreHorizontal aria-hidden />
        </TooltipTrigger>
        <TooltipContent>{m.tasks_more()}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={onEdit}>
          <PanelRight aria-hidden />
          {m.tasks_edit_details()}
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Flag aria-hidden />
            {m.tasks_priority_field()}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={shownPriority(task.priority)}
              onValueChange={(value) => {
                const next = value as ShownPriority
                if (next !== shownPriority(task.priority)) {
                  void actions.update(task.id, { priority: next })
                }
              }}
            >
              {PRIORITIES.map((p) => (
                <DropdownMenuRadioItem key={p} value={p}>
                  <Flag
                    aria-hidden
                    className={cn(p !== 'none' && 'fill-current', PRIORITY_COLORS[p])}
                  />
                  {PRIORITY_NAMES[p]()}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <Trash2 aria-hidden />
          {m.common_delete()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
          <Tooltip>
            <TooltipTrigger
              render={
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
                />
              }
            >
              <GripVertical aria-hidden />
            </TooltipTrigger>
            <TooltipContent>{m.tasks_drag()}</TooltipContent>
          </Tooltip>
        ),
      }}
    />
  )
}
