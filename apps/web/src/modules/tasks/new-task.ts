import type { TaskCreateInputBody } from '@semestra/api-client'
import { useSyncExternalStore } from 'react'
import type { ChipValues } from './components/TaskChips'
import { type Priority, type Selection } from './types'

/** Where a new task is added: what it starts with and what it is filed under (M05 §5.1). */
export type NewTaskPlace = {
  /** The chip values a new task starts with. */
  initial: ChipValues
  /** Filed under the term unless a course is picked (the course's term is used then). */
  termId?: string
  listId?: string
}

/**
 * A new task starts as the list it is added to: due today in Today and Scheduled (like
 * Reminders), flagged in Flagged, in the course of a course page or list, with the Program's
 * default priority.
 */
export function newTaskPlace(
  selection: Selection,
  {
    termId,
    courseId,
    today,
    priority,
  }: { termId?: string; courseId?: string; today: string; priority: Priority },
): NewTaskPlace {
  const smart = selection.kind === 'smart' ? selection.view : null
  return {
    initial: {
      due_date: smart === 'today' || smart === 'scheduled' ? today : null,
      due_time: null,
      priority,
      course_id: courseId ?? (selection.kind === 'course' ? selection.courseId : null),
      flagged: smart === 'flagged',
    },
    termId,
    listId: selection.kind === 'list' ? selection.listId : undefined,
  }
}

export function newTaskBody(
  place: NewTaskPlace,
  { title, notes, values }: { title: string; notes: string; values: ChipValues },
): TaskCreateInputBody {
  const body: TaskCreateInputBody = { title }
  if (notes.trim()) body.notes = notes
  if (values.due_date) {
    body.due_date = values.due_date
    if (values.due_time) body.due_time = values.due_time
  }
  // Left out while untouched, so the Program's default applies even before the settings load.
  if (values.priority !== place.initial.priority) body.priority = values.priority
  if (values.course_id) body.course_id = values.course_id
  else if (place.termId) body.term_id = place.termId
  if (place.listId) body.list_id = place.listId
  if (values.flagged) body.flagged = true
  return body
}

// The card header's add button opens the new row in the card body (one per card instance).
const opened = new Map<string, number>()
const listeners = new Set<() => void>()
let counter = 0

function emit() {
  for (const listener of listeners) listener()
}

/** Opens a card's new row; opening it again starts a fresh one. */
export function openNewTask(instanceId: string) {
  opened.set(instanceId, ++counter)
  emit()
}

export function closeNewTask(instanceId: string) {
  if (opened.delete(instanceId)) emit()
}

/** A number while the card's new row is open (new each time it opens), else null. */
export function useNewTaskOpen(instanceId: string): number | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => opened.get(instanceId) ?? null,
  )
}
