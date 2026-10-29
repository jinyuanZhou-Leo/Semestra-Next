import { useState } from 'react'
import { todayIn } from '@/modules/schedule/time'
import { getLocale } from '@/paraglide/runtime'
import { wallNow } from './due'
import { parseQuickAdd } from './parse'
import { useProgramTimezone } from './queries'
import type { Priority } from './types'

export type NewTask = {
  title: string
  due_date?: string
  due_time?: string
  priority?: Priority
}

/**
 * The state of a quick-add line (M05 §5.1), shared by the desktop field and the phone's
 * (M17): the text, what was read from it, and the words the user chose to keep as text.
 */
export function useQuickAdd({
  programId,
  defaultDue,
  onAdd,
}: {
  /** Dates and times ("tomorrow", "in 2 hours") are read in this Program's time zone. */
  programId: string
  /** Due date when the text has none, e.g. today in the Today list. */
  defaultDue?: string
  onAdd: (task: NewTask) => Promise<unknown>
}) {
  const timezone = useProgramTimezone(programId)
  const today = todayIn(timezone)
  const [text, setText] = useState('')
  // The words the user chose to keep as plain text; the choice holds while those words stay.
  const [keptDate, setKeptDate] = useState<string | null>(null)
  const [keptMark, setKeptMark] = useState<string | null>(null)
  // The clock is read with the text, so relative times count from the last keystroke.
  const first = parseQuickAdd(text, wallNow(timezone), getLocale())
  const ignoreDate = first.dateText !== null && first.dateText === keptDate
  const ignorePriority = first.priorityText !== null && first.priorityText === keptMark
  const parsed =
    ignoreDate || ignorePriority
      ? parseQuickAdd(text, wallNow(timezone), getLocale(), { ignoreDate, ignorePriority })
      : first
  const dueDate = parsed.dueDate ?? defaultDue ?? null
  const reset = () => {
    setText('')
    setKeptDate(null)
    setKeptMark(null)
  }
  // Not blocked while an earlier add is saving, so tasks can be typed one after another.
  const submit = async () => {
    if (!parsed.title) return
    const task: NewTask = { title: parsed.title }
    if (dueDate) task.due_date = dueDate
    if (parsed.dueTime && parsed.dueDate) task.due_time = parsed.dueTime
    if (parsed.priority) task.priority = parsed.priority
    reset()
    await onAdd(task).catch(() => setText((current) => current || text))
  }
  return {
    text,
    setText,
    today,
    parsed,
    /** The priority read from the text, also while it is kept as text. */
    readPriority: first.priority,
    ignoreDate,
    ignorePriority,
    toggleDate: () => setKeptDate(ignoreDate ? null : parsed.dateText),
    togglePriority: () => setKeptMark(ignorePriority ? null : parsed.priorityText),
    submit,
  }
}
