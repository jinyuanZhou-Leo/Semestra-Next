import type { TaskCreateInputBody } from '@semestra/api-client'
import { useSyncExternalStore } from 'react'
import { openImport } from '@/modules/imports/launcher'
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

/**
 * Text pasted into a new task's title that reads like more than a title (several lines, or a
 * paragraph), offered for import instead (M05 §5.1): its deadlines and dates are read and
 * reviewed in the import dialog.
 */
export function importableText(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.includes('\n') || trimmed.length > PASTE_IMPORT_CHARS
}

const PASTE_IMPORT_CHARS = 120

/** Opens the import of pasted text for the place the task would have gone (M08 text source). */
export function importPastedText(
  programId: string,
  { courseId, termId }: { courseId: string | null; termId?: string },
  text: string,
) {
  void openImport({
    programId,
    source: 'text',
    target: courseId
      ? { kind: 'course', course_id: courseId }
      : { kind: 'term', term_id: termId ?? null },
    sourceMeta: { only: 'dates' },
    mode: 'direct',
    text: text.trim(),
  })
}
