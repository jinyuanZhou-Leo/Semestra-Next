import type { AssessmentCreateInputBody } from '@semestra/api-client'
import type { UseQueryOptions } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'
import type { Message } from '@/app/extensions'

/**
 * Extension points defined by the grading module (M03 §5.1). Other modules contribute through
 * `extensions: { [POINT]: [...] }` in their manifest; read them with `useExtensions<T>(POINT)`.
 */

/** An assessment coming from an import source. `source_kind` + `source_ref` make re-imports skip it. */
export type AssessmentDraft = AssessmentCreateInputBody & {
  source_kind: NonNullable<AssessmentCreateInputBody['source_kind']>
  source_ref: string
}

export type AssessmentImportContext = { programId: string; courseId: string }

/**
 * An entry of the gradebook's "Add" menu, under "From existing material" (M09 LMS assignments,
 * M08 syllabus grading scheme).
 */
export type AssessmentImportSource = {
  id: string
  title: Message
  /** Shown instead of `title` in the menu when the label depends on the course (M09's platform). */
  Title?: ComponentType<{ programId: string; courseId: string }>
  /** What `Title` reads, loaded with the gradebook so the menu label does not change when opened. */
  // oxlint-disable-next-line no-explicit-any
  query?: (ctx: AssessmentImportContext) => UseQueryOptions<any, any, any, any>
  icon: LucideIcon
  /** One line under the title: what the source brings in. */
  description?: Message
  launch: (ctx: AssessmentImportContext) => Promise<AssessmentDraft[]>
}

export const ASSESSMENT_IMPORT_SOURCES = 'grading.assessmentImportSources'

/** Notices above a course's gradebook, e.g. M09's "assignments changed on the LMS". */
export type CourseGradesBanner = {
  id: string
  component: ComponentType<{ programId: string; courseId: string }>
}

export const COURSE_GRADES_BANNERS = 'grading.courseGradesBanners'
