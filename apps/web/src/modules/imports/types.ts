import type { ImportItem, ImportSessionDetail, SessionTarget } from '@semestra/api-client'

/**
 * The draft fields of each item type (`ImportItem.data`), as the backend stores them
 * (`modules/imports/schemas.py`). Dates are `YYYY-MM-DD`, times `HH:MM[:SS]`.
 */
export type Instructor = { name: string; email?: string | null; role?: string | null }

export type CourseData = {
  code?: string
  title: string
  credits?: number
  instructors?: Instructor[]
  description?: string
  website_url?: string
  planned_terms?: number
  existing_course_id?: string
}

export type FieldChange = { old?: unknown; new?: unknown; apply?: boolean }
export type CoursePatchData = { course_id: string; changes: Record<string, FieldChange> }

export type MeetingData = {
  course_ref: string
  term_ref?: string
  section_code?: string
  type_code?: string
  weekday: number
  start_time: string
  end_time: string
  recurrence?: 'weekly' | 'biweekly'
  first_date?: string
  last_date?: string
  weeks_text?: string
  location?: string
  instructor?: string
}

export type EventData = {
  course_ref?: string
  title: string
  date?: string
  end_date?: string
  start_time?: string
  end_time?: string
  all_day?: boolean
  kind?: 'exam' | 'deadline' | 'no_class' | 'other'
  date_text?: string
  location?: string
}

export type CategoryData = { course_ref: string; name: string; key?: string; weight_total?: number }

export type AssessmentData = {
  course_ref: string
  title: string
  category_ref?: string
  weight?: number
  due_date?: string
  due_time?: string
  due_text?: string
  note?: string
}

export type TaskData = {
  course_ref?: string
  title: string
  due_date?: string
  due_time?: string
  due_text?: string
  priority?: 'none' | 'low' | 'medium' | 'high'
  notes?: string
}

export type ItemType = ImportItem['type']

export type ImportSourceKind = 'ics' | 'syllabus' | 'timetable_image' | 'text'

/**
 * What an import source asks the import dialog for. `wizard` stops after the review and hands
 * the courses to the term wizard (the rest is written once the term exists); `direct` commits
 * from the dialog.
 */
export type ImportRequest = {
  programId: string
  source: ImportSourceKind
  target: SessionTarget
  mode: 'wizard' | 'direct'
  /** Passed to `imports.session.create` (e.g. `{ only: 'course_info' }`). */
  sourceMeta?: Record<string, unknown>
}

/** null when the user closed the dialog without finishing. */
export type ImportOutcome = { session: ImportSessionDetail } | null

export function dataOf<T>(item: ImportItem): T {
  return item.data as T
}

/** `item:<id>` / `course:<id>` → the id, and which kind it is. */
export function parseRef(
  ref: string | undefined,
): { kind: 'item' | 'course' | 'key'; id: string } | null {
  if (!ref) return null
  const [kind, ...rest] = ref.split(':')
  if (kind !== 'item' && kind !== 'course' && kind !== 'key') return null
  return { kind, id: rest.join(':') }
}
