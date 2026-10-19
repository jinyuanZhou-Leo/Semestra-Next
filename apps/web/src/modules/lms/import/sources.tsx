import { lmsCourseApplyUpdates } from '@semestra/api-client'
import { ClipboardList, School } from 'lucide-react'
import type { CommandContribution } from '@/app/extensions'
import type { TermWizardImportSource } from '@/modules/academics/types'
import type { AssessmentImportSource } from '@/modules/grading/types'
import { wizardImportSource } from '@/modules/imports/entries'
import { openImport } from '@/modules/imports/launcher'
import { m } from '@/paraglide/messages'
import { AssignmentPicker } from './AssignmentPicker'
import { type CourseImportTarget, CoursePicker } from './CoursePicker'

/** The M08 import dialog, starting with the course picker (M09 §7.2). */
function courseRequest(programId: string, target: CourseImportTarget, mode: 'wizard' | 'direct') {
  return {
    programId,
    mode,
    source: 'picker' as const,
    picker: {
      title: m.lms_import_courses,
      hint: m.lms_import_courses_hint,
      component: ({
        onStarted,
      }: {
        onStarted: Parameters<typeof CoursePicker>[0]['onStarted']
      }) => <CoursePicker programId={programId} target={target} onStarted={onStarted} />,
    },
  }
}

/** "Import courses from LMS" in the term wizard: the wizard creates the courses, then the links. */
export const wizardCourseSource: TermWizardImportSource = wizardImportSource({
  id: 'lms.courses',
  title: m.lms_import_courses,
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

/** The gradebook's "Import from… → LMS assignments": committed in the dialog. */
export const assignmentSource: AssessmentImportSource = {
  id: 'lms.assignments',
  title: m.lms_import_assignments,
  icon: ClipboardList,
  launch: async ({ programId, courseId }) => {
    await openImport({
      programId,
      mode: 'direct',
      source: 'picker',
      picker: {
        title: m.lms_import_assignments,
        hint: m.lms_import_assignments_hint,
        component: ({ onStarted }) => (
          <AssignmentPicker courseId={courseId} onStarted={onStarted} />
        ),
      },
    })
    return []
  },
}

/** The review of changed assignments: the session already exists when the dialog opens. */
export async function reviewUpdates(programId: string, courseId: string) {
  const { data } = await lmsCourseApplyUpdates({
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
