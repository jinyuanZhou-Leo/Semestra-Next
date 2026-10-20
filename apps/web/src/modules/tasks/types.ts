import type { Task, TaskList } from '@semestra/api-client'
import type { LucideIcon } from 'lucide-react'
import { CalendarClock, CircleCheck, CircleDashed, Flag, ListTodo, Sun } from 'lucide-react'
import type { Message } from '@/app/extensions'
import { m } from '@/paraglide/messages'

export type Priority = Task['priority']
export type SmartView = 'today' | 'scheduled' | 'all' | 'flagged' | 'completed'
/**
 * What the task list shows: a smart list, the unsorted tasks (no list; `inbox` in the API), or
 * one user list.
 */
export type Selection =
  | { kind: 'smart'; view: SmartView }
  | { kind: 'inbox' }
  | { kind: 'list'; listId: string }
  | { kind: 'course'; courseId: string }
export type SortKey = 'manual' | 'due' | 'priority' | 'created' | 'title'

/**
 * The four levels the UI offers (M05 §5.1). The API also has `urgent`; the UI shows it as high
 * (`shownPriority`) and leaves it as it is unless the user picks another level.
 */
export const PRIORITIES = ['none', 'low', 'medium', 'high'] as const
export type ShownPriority = (typeof PRIORITIES)[number]

export function shownPriority(priority: Priority): ShownPriority {
  return priority === 'urgent' ? 'high' : priority
}
export const SORT_KEYS: readonly SortKey[] = ['manual', 'due', 'priority', 'created', 'title']

export const SMART_VIEWS: readonly {
  view: SmartView
  title: Message
  icon: LucideIcon
}[] = [
  { view: 'today', title: m.tasks_view_today, icon: Sun },
  { view: 'scheduled', title: m.tasks_view_scheduled, icon: CalendarClock },
  { view: 'all', title: m.tasks_view_all, icon: ListTodo },
  { view: 'flagged', title: m.tasks_view_flagged, icon: Flag },
  { view: 'completed', title: m.tasks_view_completed, icon: CircleCheck },
]
/** Tasks in no list. Kept as `inbox` in keys and the API; shown as "Unsorted". */
export const INBOX = { title: m.tasks_view_inbox, icon: CircleDashed }

export function selectionKey(selection: Selection): string {
  return selection.kind === 'smart'
    ? selection.view
    : selection.kind === 'inbox'
      ? 'inbox'
      : selection.kind === 'list'
        ? `list:${selection.listId}`
        : `course:${selection.courseId}`
}

export function parseSelection(key: string | null | undefined): Selection {
  if (key === 'inbox') return { kind: 'inbox' }
  if (key?.startsWith('list:')) return { kind: 'list', listId: key.slice(5) }
  if (key?.startsWith('course:')) return { kind: 'course', courseId: key.slice(7) }
  const view = SMART_VIEWS.find((v) => v.view === key)
  return { kind: 'smart', view: view?.view ?? 'all' }
}

/** Lists of the term first, then the Program-wide ones, each in its own order. */
export function orderLists(lists: readonly TaskList[]): TaskList[] {
  return [...lists].sort(
    (a, b) => Number(a.term_id === null) - Number(b.term_id === null) || a.position - b.position,
  )
}
