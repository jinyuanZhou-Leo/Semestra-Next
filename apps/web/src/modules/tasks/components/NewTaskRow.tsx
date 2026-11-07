import type { Course, TaskCreateInputBody } from '@semestra/api-client'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { type NewTaskPlace, newTaskBody } from '../new-task'
import { focusAt, useEditorExit } from './editor-exit'
import { type ChipValues, TaskChips } from './TaskChips'

type Props = {
  /** Set while the row is open; a new value starts a fresh task. */
  openKey: number | null
  /** Opens the row from its empty circle; without it the row shows only while open. */
  onOpen?: () => void
  onClose: () => void
  place: NewTaskPlace
  courses: readonly Course[]
  /** The Program's today, for "Today"/"Tomorrow" labels. */
  today: string
  hideCourse?: boolean
  /** Smaller, for board cards. */
  compact?: boolean
  onAdd: (body: TaskCreateInputBody) => Promise<unknown>
}

/**
 * The new task at the end of a list (M05 §5.1), like Reminders: the empty circle opens it with
 * the title, the notes and the same chips as a task being edited (date, priority, course, flag).
 * Enter adds the task and leaves the row open for the next one; a click outside adds what was
 * typed and closes it; Esc drops it.
 */
export function NewTaskRow({ openKey, onOpen, onClose, compact, ...editor }: Props) {
  const circle = (
    <span
      aria-hidden
      className={cn(
        'shrink-0 rounded-full border border-dashed border-muted-foreground/50',
        compact ? 'size-4.5' : 'mt-0.5 size-5',
      )}
    />
  )
  if (openKey !== null) {
    return (
      <NewTaskEditor
        key={openKey}
        circle={circle}
        compact={compact}
        onClose={onClose}
        {...editor}
      />
    )
  }
  if (!onOpen) return null
  return (
    <li className="flex items-center gap-3 rounded-2xl px-3 py-2.5">
      {circle}
      <button
        type="button"
        className="flex-1 cursor-text text-left text-base font-medium text-transparent outline-none hover:text-muted-foreground focus-visible:text-muted-foreground"
        onClick={onOpen}
      >
        {m.tasks_new_row()}
      </button>
    </li>
  )
}

function NewTaskEditor({
  circle,
  onClose,
  place,
  courses,
  today,
  hideCourse,
  compact,
  onAdd,
}: Omit<Props, 'openKey' | 'onOpen'> & { circle: React.ReactNode }) {
  const rowRef = useRef<HTMLLIElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const closed = useRef(false)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [values, setValues] = useState<ChipValues>(place.initial)
  useEffect(() => {
    focusAt(titleRef.current)
  }, [])
  // Not blocked while an earlier add is saving, so tasks can be typed one after another.
  const add = () => {
    const next = title.trim()
    if (!next) return
    const body = newTaskBody(place, { title: next, notes, values })
    setTitle('')
    setNotes('')
    setValues(place.initial)
    void onAdd(body).catch(() => setTitle((current) => current || next))
  }
  const finish = (save: boolean) => {
    if (closed.current) return
    closed.current = true
    if (save) add()
    onClose()
  }
  useEditorExit(rowRef, { onLeave: () => finish(true), onEscape: () => finish(false) })
  const keys = (event: React.KeyboardEvent, enterAdds: boolean) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter' && (enterAdds || event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      add()
      focusAt(titleRef.current)
    }
  }
  return (
    <li
      ref={rowRef}
      className={cn(
        'flex items-start bg-muted/70',
        compact ? 'gap-2 rounded-lg px-2 py-1.5' : 'gap-3 rounded-2xl px-3 py-2.5',
      )}
    >
      {circle}
      <div className="min-w-0 flex-1 space-y-0.5">
        <input
          ref={titleRef}
          aria-label={m.tasks_new_row()}
          placeholder={m.tasks_new_row()}
          className={cn(
            'block w-full bg-transparent p-0 font-medium outline-none placeholder:text-muted-foreground',
            compact ? 'text-sm' : 'text-base',
          )}
          value={title}
          maxLength={300}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => keys(event, true)}
        />
        <textarea
          aria-label={m.tasks_notes_label()}
          placeholder={m.tasks_notes_label()}
          rows={Math.min(Math.max(notes.split('\n').length, 1), 8)}
          maxLength={20000}
          className={cn(
            'block w-full resize-none bg-transparent p-0 text-muted-foreground outline-none placeholder:text-muted-foreground/70',
            compact ? 'text-xs' : 'text-sm',
          )}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          onKeyDown={(event) => keys(event, false)}
        />
        <div className="pt-1.5 pb-0.5">
          <TaskChips
            task={values}
            courses={courses}
            today={today}
            hideCourse={hideCourse}
            overdue={values.due_date !== null && values.due_date < today}
            onChange={(body) => setValues((current) => ({ ...current, ...body }) as ChipValues)}
          />
        </div>
      </div>
    </li>
  )
}
