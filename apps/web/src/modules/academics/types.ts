import type { Course } from '@semestra/api-client'
import type { LucideIcon } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import type { Message } from '@/app/extensions'

/**
 * Extension points defined by the academics module (M02 §5). Other modules contribute through
 * `extensions: { [POINT]: [...] }` in their manifest; read them with `useExtensions<T>(POINT)`.
 */

/** A column of the all-courses table, and optionally of the term's course card. */
export type CourseColumn = {
  id: string
  header: Message
  cell: (course: Course) => ReactNode
  sortValue?: (course: Course) => string | number | null
  /** Quick filters offered above the table (e.g. GPA ≥ 3.5). */
  filter?: { id: string; label: Message; test: (course: Course) => boolean }[]
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
export const PROGRAM_SETUP_FIELDS = 'academics.programSetupFields'
export const ONBOARDING_STEPS = 'academics.onboardingSteps'
