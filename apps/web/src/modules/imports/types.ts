import type { ImportItem, ImportSessionDetail, SessionTarget } from '@semestra/api-client'
import type { ComponentType } from 'react'

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
/** `assessment_patch` / `task_patch` (M09 LMS updates); `label` names the item. */
export type TargetPatchData = { label?: string; changes: Record<string, FieldChange> }

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
  /** Dates the class is cancelled (ICS EXDATE, missing weeks); written as cancellations. */
  exceptions?: string[]
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
 * The first step of the import dialog for a source that creates the session itself, e.g. M09's
 * LMS course and assignment pickers. `component` calls `onStarted` with the new session.
 */
export type ImportPicker = {
  title: () => string
  /** Shown instead of `title` when it depends on loaded data (M09: "Import courses from Canvas"). */
  Title?: ComponentType
  hint: () => string
  component: ComponentType<{ onStarted: (session: ImportSessionDetail) => void }>
}

/**
 * What an import source asks the import dialog for. `wizard` stops after the review and hands
 * the courses to the term wizard (the rest is written once the term exists); `direct` commits
 * from the dialog.
 */
export type ImportRequest = {
  programId: string
  mode: 'wizard' | 'direct'
} & (
  | {
      source: ImportSourceKind
      target: SessionTarget
      /** Passed to `imports.session.create` (e.g. `{ only: 'course_info' }`). */
      sourceMeta?: Record<string, unknown>
    }
  | { source: 'picker'; picker: ImportPicker }
  /** A session created elsewhere (e.g. M09's review of changed assignments): straight to the review. */
  | { source: 'session'; sessionId: string; title: () => string }
)

export type FileImportRequest = Extract<ImportRequest, { source: ImportSourceKind }>

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
