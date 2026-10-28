import { importsSessionCommit } from '@semestra/api-client'
import type { QueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import type {
  CourseDraft,
  CourseInfoAction,
  CreatedCourseMapping,
  TermWizardContext,
  TermWizardImportSource,
} from '@/modules/academics/types'
import type { FileItemAction } from '@/modules/files/types'
import type { AssessmentImportSource } from '@/modules/grading/types'
import type { MeetingImportSource } from '@/modules/schedule/types'
import { m } from '@/paraglide/messages'
import { openImport } from './launcher'
import { SOURCES, readableCourseFile } from './sources'
import type { CourseData, ImportRequest, ImportSourceKind } from './types'

/**
 * The import sources M08 contributes to other modules' extension points (M08 §6.1). Each one
 * opens the import dialog through `openImport` and resolves when the user closes it.
 */

let queryClient: QueryClient | null = null

/** The import host hands over the app's query client, for writes made after the dialog closed. */
export function setImportQueryClient(client: QueryClient | null) {
  queryClient = client
}

type Extras = { importSessionId: string; importItemId: string }

export function wizardSource(source: ImportSourceKind): TermWizardImportSource {
  return wizardImportSource({
    id: `imports.${source}`,
    title: SOURCES[source].title,
    description: SOURCES[source].hint,
    icon: SOURCES[source].icon,
    request: ({ programId, startDate, endDate }) => ({
      programId,
      source,
      target: { kind: 'term_wizard', start_date: startDate, end_date: endDate },
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
      await queryClient?.invalidateQueries()
      if (failed > 0) toast.error(m.imports_commit_partial({ failed }))
    },
  }
}

/** The gradebook's "Import from… → Syllabus": commits in the dialog, so no drafts come back. */
export const syllabusGradingSource: AssessmentImportSource = {
  id: 'imports.syllabus',
  title: m.imports_source_syllabus_grading,
  description: m.imports_source_syllabus_grading_description,
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

/** "Update from syllabus" on the course info card: only the course's own fields. */
export const courseInfoFromSyllabus: CourseInfoAction = {
  id: 'imports.course-info',
  title: m.imports_update_course_info,
  icon: SOURCES.syllabus.icon,
  run: async ({ programId, courseId }) => {
    await openImport({
      programId,
      source: 'syllabus',
      target: { kind: 'course', course_id: courseId },
      mode: 'direct',
      sourceMeta: { only: 'course_info' },
    })
  },
}

/**
 * "Read with AI…" on a course file: the syllabus import with that file already picked. The file
 * is not uploaded again; the import reads what M07 parsed, waiting while it is still processing.
 */
export const readCourseFile: FileItemAction = {
  id: 'imports.read-file',
  title: m.imports_read_file,
  description: m.imports_read_file_description,
  icon: Sparkles,
  accepts: readableCourseFile,
  run: async ({ programId, item }) => {
    await openImport({
      programId,
      source: 'syllabus',
      target: { kind: 'course', course_id: item.course_id },
      mode: 'direct',
      fileItemIds: [item.id],
    })
  },
}
