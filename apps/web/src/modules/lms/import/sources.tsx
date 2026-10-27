import { type ImportSessionDetail, lmsCourseQueueUpdates } from '@semestra/api-client'
import { lmsProgramBindingGetOptions } from '@semestra/api-client/react-query'
import { ClipboardList, School } from 'lucide-react'
import { Suspense } from 'react'
import { type CommandContribution, preload, preloadable } from '@/app/extensions'
import type { TermWizardImportSource } from '@/modules/academics/types'
import type { AssessmentImportSource } from '@/modules/grading/types'
import { wizardImportSource } from '@/modules/imports/entries'
import { openImport } from '@/modules/imports/launcher'
import { m } from '@/paraglide/messages'
import { useProgramProviderName } from '../providers'
import type { CourseImportTarget } from './CoursePicker'

type Started = { onStarted: (session: ImportSessionDetail) => void }

// The pickers load when an import starts, not with the app (this file is part of the manifest).
const CoursePicker = preloadable<Started & { programId: string; target: CourseImportTarget }>(() =>
  import('./CoursePicker').then((mod) => ({ default: mod.CoursePicker })),
)
const AssignmentPicker = preloadable<Started & { courseId: string }>(() =>
  import('./AssignmentPicker').then((mod) => ({ default: mod.AssignmentPicker })),
)

/** "Import courses from {provider}": the Program's platform, "LMS" while unbound or loading. */
function CoursesTitle({ programId }: { programId: string }) {
  const provider = useProgramProviderName(programId)
  return provider ? m.lms_import_courses_from({ provider }) : m.lms_import_courses()
}

/** "{provider} assignments" for a course's gradebook menu, from the Program's platform. */
function AssignmentsTitle({ programId }: { programId: string }) {
  const provider = useProgramProviderName(programId)
  return provider ? m.lms_import_assignments_from({ provider }) : m.lms_import_assignments()
}

/** The M08 import dialog, starting with the course picker (M09 §7.2). */
function courseRequest(programId: string, target: CourseImportTarget, mode: 'wizard' | 'direct') {
  void preload(CoursePicker)
  return {
    programId,
    mode,
    source: 'picker' as const,
    picker: {
      title: m.lms_import_courses,
      Title: () => <CoursesTitle programId={programId} />,
      hint: m.lms_import_courses_hint,
      component: ({ onStarted }: Started) => (
        <Suspense fallback={null}>
          <CoursePicker programId={programId} target={target} onStarted={onStarted} />
        </Suspense>
      ),
    },
  }
}

/** "Import courses from {provider}" in the term wizard: the wizard creates the courses, then the links. */
export const wizardCourseSource: TermWizardImportSource = wizardImportSource({
  id: 'lms.courses',
  title: m.lms_import_courses,
  Title: CoursesTitle,
  query: (programId) => lmsProgramBindingGetOptions({ path: { program_id: programId } }),
  description: m.lms_import_courses_hint,
  icon: School,
  request: ({ programId, startDate, endDate }) =>
    courseRequest(programId, { wizard: true, startDate, endDate }, 'wizard'),
})

/** The same from the command palette on a term page: the courses go to that term. */
export const termCourseCommand: CommandContribution = {
  id: 'lms.import-courses',
  title: m.lms_import_courses,
  icon: School,
  scopes: ['term'],
  isAvailable: ({ scope }) => scope?.kind === 'term',
  run: async ({ scope }) => {
    if (scope?.kind !== 'term') return
    await openImport(courseRequest(scope.programId, { termId: scope.termId }, 'direct'))
  },
}

/** The gradebook's "Import from… → {provider} assignments": committed in the dialog. */
export const assignmentSource: AssessmentImportSource = {
  id: 'lms.assignments',
  title: m.lms_import_assignments,
  Title: AssignmentsTitle,
  query: ({ programId }) => lmsProgramBindingGetOptions({ path: { program_id: programId } }),
  icon: ClipboardList,
  launch: async ({ programId, courseId }) => {
    void preload(AssignmentPicker)
    await openImport({
      programId,
      mode: 'direct',
      source: 'picker',
      picker: {
        title: m.lms_import_assignments,
        Title: () => <AssignmentsTitle programId={programId} />,
        hint: m.lms_import_assignments_hint,
        component: ({ onStarted }) => (
          <Suspense fallback={null}>
            <AssignmentPicker courseId={courseId} onStarted={onStarted} />
          </Suspense>
        ),
      },
    })
    return []
  },
}

/** The review of changed assignments: the session already exists when the dialog opens. */
export async function reviewUpdates(programId: string, courseId: string) {
  const { data } = await lmsCourseQueueUpdates({
    path: { course_id: courseId },
    throwOnError: true,
  })
  return openImport({
    programId,
    mode: 'direct',
    source: 'session',
    sessionId: data.session_id,
    title: m.lms_updates_title,
  })
}
