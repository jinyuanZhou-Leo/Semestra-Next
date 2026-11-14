import type { Assessment, AssessmentCreateInputBody } from '@semestra/api-client'
import type { QueryClient, UseQueryOptions } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'
import type { Message } from '@/app/extensions'
import type { DialogTargetProps } from '@/lib/dialog-target'

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

/**
 * A column of the gradebook from another module (M05's to-do column), before the row menu. Its
 * cell loads what it shows itself: rows that read the same query share one request.
 */
export type AssessmentColumn = {
  id: string
  header: Message
  Cell: ComponentType<{ assessment: Assessment; programId: string }>
  prefetch?: AssessmentPrefetch
}

/**
 * Starts what a gradebook contribution reads for a course along with the page (`prefetch` of the
 * grades page), so its rows do not wait for the table to render before asking.
 */
export type AssessmentPrefetch = (
  course: { programId: string; courseId: string },
  queryClient: QueryClient,
) => void

export const ASSESSMENT_COLUMNS = 'grading.assessmentColumns'

/**
 * An entry of a gradebook row's menu from another module (M09's "Bind Canvas assignment…"), with
 * the dialog it opens. The gradebook keeps the dialog, so it stays open after the menu closes.
 */
export type AssessmentAction = {
  id: string
  /** Shown after a separator, before "Delete" (M00 §4.8: undoing actions go last). */
  destructive?: boolean
  /** The menu item; renders nothing when the action does not apply to this assessment. */
  Item: ComponentType<AssessmentActionItemProps>
  Dialog: ComponentType<AssessmentActionDialogProps>
  prefetch?: AssessmentPrefetch
}

export type AssessmentActionItemProps = {
  assessment: Assessment
  programId: string
  open: () => void
}

export type AssessmentActionDialogProps = DialogTargetProps & {
  assessment: Assessment | null
  programId: string
  close: () => void
}

export const ASSESSMENT_ACTIONS = 'grading.assessmentActions'
