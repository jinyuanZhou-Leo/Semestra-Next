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

export type TermWizardContext = {
  programId: string
  startDate?: string
  endDate?: string
  /** "Add course" on a term that exists: imports use its real weeks (breaks skipped). */
  termId?: string
}

/** `onCoursesCreated` gets the ids the wizard created, keyed by draft index. */
export type CreatedCourseMapping = { draft: CourseDraft; courseId: string }[]

export type TermWizardImportSource = {
  id: string
  title: Message
  /** Shown instead of `title` in the menu when the label depends on the Program (M09's platform). */
  Title?: ComponentType<{ programId: string }>
  /** What `Title` reads, loaded with the wizard so the menu label does not change when opened. */
  // oxlint-disable-next-line no-explicit-any
  query?: (programId: string) => UseQueryOptions<any, any, any, any>
  icon: LucideIcon
  description?: Message
  /**
   * What the source needs set up first (a key an onboarding step `provides`, e.g. `ai.vision`,
   * `lms`). Onboarding lists only sources whose needs are met; elsewhere they gate themselves.
   */
  requires?: string
  launch: (ctx: TermWizardContext) => Promise<CourseDraft[]>
  /** Called after the term was created for the drafts of this source that carry `extras`. */
  onCoursesCreated?: (mapping: CreatedCourseMapping) => Promise<void>
}

/**
 * Fills the course's basics from somewhere else, shown above them in the course settings (M08
 * "Read from a file"). It writes the course itself; `onApplied` then reloads the form.
 */
export type CourseInfoFill = {
  id: string
  component: ComponentType<{ programId: string; courseId: string; onApplied: () => void }>
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

/**
 * A row on the Program form (onboarding and "New Program"); its value goes to `program.create`
 * `setup[id]`. Going back to the Program step of onboarding edits the Program that exists, so
 * the field also says how to `apply` a changed value to it.
 */
export type ProgramSetupField = {
  id: string
  order: number
  component: ComponentType<{ value: unknown; onChange: (value: unknown) => void }>
  apply: (programId: string, value: unknown) => Promise<void>
}

/** Moves between onboarding steps; what a step was given is kept when it is left. */
export type OnboardingNav = { back: () => void; next: () => void }

export type OnboardingStepProps = { programId: string; nav: OnboardingNav }

/**
 * An onboarding step another module adds (M02 §5.7), between the host's own steps: language
 * (0), Program (10), first term (500), done (1000). Steps that set something up come before the
 * term, so what the term wizard offers can use it.
 */
export type OnboardingStep = {
  id: string
  order: number
  icon: LucideIcon
  title: Message
  description: Message
  /** The step, ending in `StepFooter` (back, skip, its own action). */
  component: ComponentType<OnboardingStepProps>
  /** Its line on the done step (`SummaryRow`). */
  summary: ComponentType<{ programId: string }>
  /** Leaves the step out where it cannot apply (notifications in a browser without them). */
  available?: () => boolean
  /**
   * What the step has set up, from the server: `offered` false leaves the step out (no LMS on
   * this server); `provides` are the keys import sources can `require` (e.g. `ai.extraction`).
   */
  status?: {
    // oxlint-disable-next-line no-explicit-any
    queries: (programId: string | undefined) => readonly UseQueryOptions<any, any, any, any>[]
    read: (data: readonly unknown[]) => { offered: boolean; provides: readonly string[] }
  }
}

export const COURSE_COLUMNS = 'academics.courseColumns'
export const TERM_WIZARD_IMPORT_SOURCES = 'academics.termWizardImportSources'
export const COURSE_INFO_FILLS = 'academics.courseInfoFills'
export const COURSE_INFO_ROWS = 'academics.courseInfoRows'
export const PROGRAM_SETUP_FIELDS = 'academics.programSetupFields'
export const ONBOARDING_STEPS = 'academics.onboardingSteps'
