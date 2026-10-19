import { CalendarDays, Flag, Plus, X } from 'lucide-react'
import { type Ref, useState } from 'react'
import { m } from '@/paraglide/messages'
import { getLocale } from '@/paraglide/runtime'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { dueLabel, localDate } from '../due'
import { parseQuickAdd } from '../parse'
import type { Priority } from '../types'
import { PRIORITY_NAMES } from './TaskRow'

export type NewTask = {
  title: string
  due_date?: string
  due_time?: string
  priority?: Priority
}

/**
 * The line under a list (M05 §5.1): Enter adds the task. A date, a time and `!`/`!!`/`!!!` in the
 * text are read and shown as chips that can be undone before adding.
 */
export function QuickAdd({
  inputRef,
  today,
  defaultDue,
  disabled,
  onAdd,
}: {
  inputRef?: Ref<HTMLInputElement>
  /** The Program's today (`useProgramToday`): "tomorrow" is read relative to it. */
  today: string
  /** Due date when the text has none, e.g. today in the Today list. */
  defaultDue?: string
  disabled?: boolean
  onAdd: (task: NewTask) => Promise<unknown>
}) {
  const [text, setText] = useState('')
  // The words the user chose to keep as plain text; the choice holds while those words stay.
  const [keptDate, setKeptDate] = useState<string | null>(null)
  const [keptMark, setKeptMark] = useState<string | null>(null)
  const now = localDate(today)
  const first = parseQuickAdd(text, now, getLocale())
  const ignoreDate = first.dateText !== null && first.dateText === keptDate
  const ignorePriority = first.priorityText !== null && first.priorityText === keptMark
  const parsed =
    ignoreDate || ignorePriority
      ? parseQuickAdd(text, now, getLocale(), { ignoreDate, ignorePriority })
      : first
  const dueDate = parsed.dueDate ?? defaultDue ?? null
  const reset = () => {
    setText('')
    setKeptDate(null)
    setKeptMark(null)
  }
  const submit = async () => {
    if (!parsed.title || disabled) return
    const task: NewTask = { title: parsed.title }
    if (dueDate) task.due_date = dueDate
    if (parsed.dueTime && parsed.dueDate) task.due_time = parsed.dueTime
    if (parsed.priority) task.priority = parsed.priority
    reset()
    await onAdd(task).catch(() => setText(text))
  }
  return (
    <div className="space-y-1.5 rounded-2xl px-3 py-2.5 hover:bg-muted/40">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/60"
        >
          <Plus className="size-3 text-muted-foreground" />
        </span>
        <Input
          ref={inputRef}
          value={text}
          maxLength={400}
          placeholder={m.tasks_quick_add_placeholder()}
          aria-label={m.tasks_quick_add_label()}
          className="h-6 border-0 bg-transparent px-0 text-base font-medium shadow-none focus-visible:ring-0"
          onChange={(event) => {
            setText(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void submit()
            }
            if (event.key === 'Escape') event.currentTarget.blur()
          }}
        />
      </div>
      {parsed.dateText || parsed.priorityText ? (
        <div className="flex flex-wrap items-center gap-1.5 pl-8">
          {parsed.dateText ? (
            <Chip
              undone={ignoreDate}
              label={
                ignoreDate
                  ? parsed.dateText
                  : dueLabel({ due_date: parsed.dueDate, due_time: parsed.dueTime }, today)
              }
              icon={<CalendarDays aria-hidden />}
              undoLabel={m.tasks_quick_add_undo({ text: parsed.dateText })}
              onToggle={() => setKeptDate(ignoreDate ? null : parsed.dateText)}
            />
          ) : null}
          {parsed.priorityText ? (
            <Chip
              undone={ignorePriority}
              label={
                ignorePriority
                  ? parsed.priorityText
                  : PRIORITY_NAMES[priorityOf(parsed.priorityText)]()
              }
              icon={<Flag aria-hidden />}
              undoLabel={m.tasks_quick_add_undo({ text: parsed.priorityText })}
              onToggle={() => setKeptMark(ignorePriority ? null : parsed.priorityText)}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function priorityOf(marks: string): Priority {
  return marks.length >= 3 ? 'urgent' : marks.length === 2 ? 'high' : 'medium'
}

function Chip({
  label,
  icon,
  undone,
  undoLabel,
  onToggle,
}: {
  label: string
  icon: React.ReactNode
  undone: boolean
  undoLabel: string
  onToggle: () => void
}) {
  return (
    <Badge variant={undone ? 'outline' : 'secondary'} className="gap-1 pr-0.5">
      {icon}
      <span className={undone ? 'line-through' : undefined}>{label}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="size-4"
        aria-label={undoLabel}
        aria-pressed={undone}
        onClick={onToggle}
      >
        <X aria-hidden />
      </Button>
    </Badge>
  )
}
