import { importsSessionCommit } from '@semestra/api-client'
import { toast } from 'sonner'
import type { FileDropContribution } from '@/app/extensions'
import type {
  CourseDraft,
  CreatedCourseMapping,
  TermWizardContext,
  TermWizardImportSource,
} from '@/modules/academics/types'
import type { AssessmentImportSource } from '@/modules/grading/types'
import type { MeetingImportSource } from '@/modules/schedule/types'
import { m } from '@/paraglide/messages'
import { importDetail } from './entry-detail'
import { openImport } from './launcher'
import { SOURCES } from './sources'
import type { CourseData, ImportRequest, ImportSourceKind } from './types'
import { wizardTarget } from './unfinished'

/**
 * The import sources M08 contributes to other modules' extension points (M08 §6.1). Each one
 * opens the import dialog through `openImport` and resolves when the user closes it.
 */

type Extras = { importSessionId: string; importItemId: string }

export function wizardSource(source: ImportSourceKind): TermWizardImportSource {
  return wizardImportSource({
    id: `imports.${source}`,
    title: SOURCES[source].title,
    description: SOURCES[source].hint,
    Detail: importDetail(
      (context) => ({ source, target: wizardTarget(context) }),
      SOURCES[source].hint,
    ),
    icon: SOURCES[source].icon,
    requires: SOURCES[source].purpose ? `ai.${SOURCES[source].purpose}` : undefined,
    request: ({ programId, startDate, endDate, termId }) => ({
      programId,
      source,
      target: { kind: 'term_wizard', start_date: startDate, end_date: endDate, term_id: termId },
      mode: 'wizard',
    }),
  })
}

/**
 * A term wizard source backed by an import session (also M09's "Import courses from LMS"):
 * the reviewed courses become the wizard's drafts, and once the wizard created them the session
 * is committed with that mapping, writing everything that belongs to them.
 */
export function wizardImportSource({
  request,
  ...entry
}: Omit<TermWizardImportSource, 'launch' | 'onCoursesCreated'> & {
  request: (ctx: TermWizardContext) => ImportRequest | null
}): TermWizardImportSource {
  return {
    ...entry,
    launch: async (ctx) => {
      const wanted = request(ctx)
      const outcome = wanted ? await openImport(wanted) : null
      if (!outcome) return []
      const { session } = outcome
      return session.items
        .filter((item) => item.type === 'course' && item.decision === 'accept')
        .map((item): CourseDraft => {
          const data = item.data as CourseData
          const extras: Extras = { importSessionId: session.id, importItemId: item.id }
          return {
            code: data.code,
            title: data.title,
            credits: data.credits,
            instructors: data.instructors,
            description: data.description,
            plannedTerms: data.planned_terms,
            source: { kind: session.source_kind, ref: item.id },
            extras,
          }
        })
    },
    // The wizard created the courses (and the term); now write what belongs to them.
    onCoursesCreated: async (mapping: CreatedCourseMapping) => {
      const bySession = new Map<string, { item_id: string; course_id: string }[]>()
      for (const { draft, courseId } of mapping) {
        const extras = draft.extras as Extras | undefined
        if (!extras) continue
        const list = bySession.get(extras.importSessionId) ?? []
        list.push({ item_id: extras.importItemId, course_id: courseId })
        bySession.set(extras.importSessionId, list)
      }
      let failed = 0
      for (const [sessionId, courses] of bySession) {
        const { data } = await importsSessionCommit({
          path: { session_id: sessionId },
          body: { wizard_courses: courses },
          throwOnError: true,
        })
        failed += data.failed
      }
      if (failed > 0) toast.error(m.imports_commit_partial({ failed }))
    },
  }
}

/** The gradebook's "Import from… → Syllabus": commits in the dialog, so no drafts come back. */
export const syllabusGradingSource: AssessmentImportSource = {
  id: 'imports.syllabus',
  title: m.imports_source_syllabus_grading,
  description: m.imports_source_syllabus_grading_description,
  Detail: importDetail(
    ({ courseId }: { programId: string; courseId: string }) => ({
      source: 'syllabus',
      target: { kind: 'course', course_id: courseId },
    }),
    m.imports_source_syllabus_grading_description,
  ),
  emptyAction: m.imports_source_syllabus_grading_empty,
  icon: SOURCES.syllabus.icon,
  launch: async ({ programId, courseId }) => {
    await openImport({
      programId,
      source: 'syllabus',
      target: { kind: 'course', course_id: courseId },
      mode: 'direct',
    })
    return []
  },
}

export function meetingSource(source: 'ics' | 'timetable_image'): MeetingImportSource {
  return {
    id: `imports.${source}`,
    title: SOURCES[source].title,
    description: SOURCES[source].hint,
    Detail: importDetail(
      ({ courseId, termId }: { programId: string; courseId: string; termId: string }) => ({
        source,
        target: { kind: 'course', course_id: courseId, term_id: termId },
      }),
      SOURCES[source].hint,
    ),
    icon: SOURCES[source].icon,
    launch: async ({ programId, courseId, termId }) => {
      await openImport({
        programId,
        source,
        target: { kind: 'course', course_id: courseId, term_id: termId },
        mode: 'direct',
      })
    },
  }
}

/**
 * Files dropped on a course page open the import that page offers, with them picked (M08 §6.1):
 * a syllabus on the gradebook or the course overview, a calendar file or a timetable screenshot
 * on the course schedule. Reading starts when the user presses "Read", as from the menu.
 */
export function courseFileDrop(
  source: 'syllabus' | 'ics' | 'timetable_image',
  pages: readonly string[],
  label: () => string,
): FileDropContribution {
  return {
    id: `imports.${source}`,
    pages,
    accept: SOURCES[source].accept ?? {},
    label,
    onDrop: (scope, files) => {
      if (scope.kind !== 'course') return
      void openImport({
        programId: scope.programId,
        source,
        target: { kind: 'course', course_id: scope.courseId },
        mode: 'direct',
        files,
      })
    },
  }
}
