import type { Course } from '@semestra/api-client'
import type { UseQueryOptions } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import type { Message } from '@/app/extensions'

/**
 * Extension points defined by the academics module (M02 §5). Other modules contribute through
 * `extensions: { [POINT]: [...] }` in their manifest; read them with `useExtensions<T>(POINT)`.
 */

/**
 * A column of the all-courses table, and optionally of the term's course card.
 * Data that lives in another module's API is loaded with `query`, once for the whole table,
 * and passed to `cell`, `sortValue` and the filters as `data` (undefined until it has loaded).
 */
export type CourseColumn = {
  id: string
  header: Message
  /** Loads what the column shows for a Program; the options come from a generated `…Options()`. */
  // oxlint-disable-next-line no-explicit-any
  query?: (programId: string) => UseQueryOptions<any, any, any, any>
  cell: (course: Course, data?: unknown) => ReactNode
  sortValue?: (course: Course, data?: unknown) => string | number | null
  /**
   * The options of this column's filter dropdown above the table (e.g. GPA ≥ 3.5), one chosen at
   * a time. An option whose `available` says no is neither shown nor applied (e.g. GPA filters
   * while GPA is hidden); with no option left the dropdown is not shown.
   */
  filter?: {
    id: string
    label: Message
    test: (course: Course, data?: unknown) => boolean
    available?: (data?: unknown) => boolean
  }[]
  /** Also shown in the `academics.termCourses` card. */
  showInTermCard?: boolean
}

/** A course coming from an import source into the term wizard. */
export type CourseDraft = {
  code?: string
  title: string
  credits?: number
  instructors?: { name: string; email?: string | null; role?: string | null }[]
  description?: string
  /** 2 or more for a year-long course. */
  plannedTerms?: number
  source?: { kind: string; ref: string }
  /** Defined by the source module, e.g. meeting times from an ICS file. */
  extras?: Record<string, unknown>
}

export type TermWizardContext = { programId: string; startDate?: string; endDate?: string }

/** `onCoursesCreated` gets the ids the wizard created, keyed by draft index. */
export type CreatedCourseMapping = { draft: CourseDraft; courseId: string }[]

export type TermWizardImportSource = {
  id: string
  title: Message
  icon: LucideIcon
  description?: Message
  launch: (ctx: TermWizardContext) => Promise<CourseDraft[]>
  /** Called after the term was created for the drafts of this source that carry `extras`. */
  onCoursesCreated?: (mapping: CreatedCourseMapping) => Promise<void>
}

/** An action in the menu of the course info card, e.g. "Update from syllabus" (M08). */
export type CourseInfoAction = {
  id: string
  title: Message
  icon: LucideIcon
  run: (ctx: { programId: string; courseId: string }) => Promise<void> | void
}

/** Extra lines on the course info card, e.g. the linked LMS course (M09). `Row` lays one out. */
export type CourseInfoRowProps = {
  programId: string
  courseId: string
  Row: ComponentType<{ label: string; children: ReactNode }>
}

export type CourseInfoRow = {
  id: string
  order: number
  component: ComponentType<CourseInfoRowProps>
}

/** A field on the onboarding Program form; its value goes to `program.create` `setup[id]`. */
export type ProgramSetupField = {
  id: string
  order: number
  component: ComponentType<{ value: unknown; onChange: (value: unknown) => void }>
}

/** An optional onboarding step after the first term (e.g. connecting AI, M06). */
export type OnboardingStep = {
  id: string
  order: number
  title: Message
  component: ComponentType<{ onDone: () => void }>
}

export const COURSE_COLUMNS = 'academics.courseColumns'
export const TERM_WIZARD_IMPORT_SOURCES = 'academics.termWizardImportSources'
export const COURSE_INFO_ACTIONS = 'academics.courseInfoActions'
export const COURSE_INFO_ROWS = 'academics.courseInfoRows'
export const PROGRAM_SETUP_FIELDS = 'academics.programSetupFields'
export const ONBOARDING_STEPS = 'academics.onboardingSteps'
