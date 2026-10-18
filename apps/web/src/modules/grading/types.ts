import type { AssessmentCreateInputBody } from '@semestra/api-client'
import type { LucideIcon } from 'lucide-react'
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

/** An entry of the gradebook's "Import from…" menu (M09 LMS assignments, M08 syllabus grading scheme). */
export type AssessmentImportSource = {
  id: string
  title: Message
  icon: LucideIcon
  launch: (ctx: AssessmentImportContext) => Promise<AssessmentDraft[]>
}

export const ASSESSMENT_IMPORT_SOURCES = 'grading.assessmentImportSources'
