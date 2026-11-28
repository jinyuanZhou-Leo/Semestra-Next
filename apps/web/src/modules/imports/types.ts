import type {
  ImportItem,
  ImportSessionDetail,
  SessionTarget,
  SourceOptions,
} from '@semestra/api-client'
import type { ComponentType } from 'react'
import type { ImportKey } from './unfinished'

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
/** `course_patch`: the existing course and its changed fields. */
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
  /** A grade the source already has (M09). */
  points_earned?: number
  points_possible?: number
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
  /** The imports this picker starts: an unfinished one opens where it stands instead. */
  resumes?: ImportKey
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
      sourceMeta?: SourceOptions
      /** Files already in hand (dropped on a page): the picker starts with them, not reading yet. */
      files?: File[]
      /** Text already in hand (pasted into the to-do quick add): the picker starts with it. */
      text?: string
    }
  | { source: 'picker'; picker: ImportPicker }
  /**
   * An import that already exists (one created elsewhere, e.g. M09's changed assignments, or
   * one the user comes back to): it opens where it stands. `title` defaults to its source's.
   */
  | { source: 'session'; sessionId: string; title?: () => string }
)

export type FileImportRequest = Extract<ImportRequest, { source: ImportSourceKind }>

/** null when the user closed the dialog without finishing. */
export type ImportOutcome = { session: ImportSessionDetail } | null
